/**
 * Applying an import plan to the store.
 *
 * Creates a trip from a parsed sheet in one transaction: either the whole thing
 * lands or nothing does. A half-imported trip — some expenses, some people, no
 * squads — would be worse than no import at all, because it looks finished.
 *
 * People are matched to existing `people` rows by name so that importing a
 * second trip keeps the same Joel, which is what makes cross-trip identity
 * work rather than accumulating duplicates.
 */

import { db, newId, nowIso } from './db.js';
import type {
  Expense,
  ExpenseCategory,
  Id,
  Member,
  Person,
  Segment,
  Squad,
  Trip,
} from '../domain/types.js';
import { ImportError, type ImportPlan } from '../domain/import.js';

export interface ApplyImportOptions {
  tripName: string;
  baseCurrency: string;
  startsOn: string;
  endsOn: string;
  /** Which member the importing device should act as, by sheet name. */
  meName?: string;
  /** Optional legs, so expenses land in the right segment and currency. */
  segments?: { name: string; startsOn: string; endsOn: string; defaultCurrency: string }[];
}

export interface ImportOutcome {
  trip: Trip;
  createdPeople: number;
  reusedPeople: number;
  expenses: number;
  squads: number;
}

/**
 * Guess a category from the description, so nothing lands as "other" by default.
 *
 * Accents are stripped first: "Hótel Jökulsárlón" has to read as a hotel, and
 * airport codes are matched whole — an unanchored "kul" for Kuala Lumpur also
 * appears inside Jö*kul*sárlón, which is exactly how it got filed as transport.
 */
export function categoryFor(description: string): ExpenseCategory {
  const text = description
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  if (/hotel|airbnb|hostel|apart|stay|suites|lodge|guesthouse|gistih/.test(text)) {
    return 'accommodation';
  }
  if (/flight|rental|train|bus|ferry|taxi|transfer|\bkul\b|\bldn\b/.test(text)) {
    return 'transport';
  }
  if (/lagoon|museum|tour|ticket|disney|park|entry|spa/.test(text)) return 'activity';
  if (/fuel|petrol|gas station/.test(text)) return 'fuel';
  if (/dinner|lunch|breakfast|restaurant|cafe|food/.test(text)) return 'food';
  if (/grocer|supermarket|market/.test(text)) return 'groceries';
  if (/insurance|visa|fee|deposit/.test(text)) return 'fees';
  return 'other';
}

function segmentIdFor(
  spentAt: string,
  segments: { id: Id; startsOn: string; endsOn: string }[],
): Id | undefined {
  const day = spentAt.slice(0, 10);
  // Last match wins, so a later leg claims a day the previous one ends on.
  let found: Id | undefined;
  for (const segment of segments) {
    if (day >= segment.startsOn && day <= segment.endsOn) found = segment.id;
  }
  return found;
}

export async function applyImportPlan(
  plan: ImportPlan,
  options: ApplyImportOptions,
): Promise<ImportOutcome> {
  const store = db();

  const unpaid = plan.items.filter((item) => !item.payerName);
  if (unpaid.length > 0) {
    throw new ImportError(
      `${unpaid.length} item${unpaid.length === 1 ? '' : 's'} still needs a payer`,
    );
  }
  for (const item of plan.items) {
    if (!plan.people.includes(item.payerName as string)) {
      throw new ImportError(
        `"${item.payerName}" paid for "${item.description}" but is not in the sheet`,
      );
    }
  }

  const existingPeople = await store.people.toArray();
  const byName = new Map(existingPeople.map((p) => [p.displayName.trim().toLowerCase(), p]));

  const newPeople: Person[] = [];
  const personByName = new Map<string, Person>();
  let colorIndex = existingPeople.length;

  for (const name of plan.people) {
    const existing = byName.get(name.trim().toLowerCase());
    if (existing) {
      personByName.set(name, existing);
      continue;
    }
    const person: Person = {
      id: newId(),
      displayName: name.trim(),
      colorIndex: colorIndex++,
      createdAt: nowIso(),
    };
    newPeople.push(person);
    personByName.set(name, person);
  }

  const firstPerson = personByName.get(plan.people[0] as string) as Person;
  const trip: Trip = {
    id: newId(),
    name: options.tripName.trim() || 'Imported trip',
    baseCurrency: options.baseCurrency.toUpperCase(),
    startsOn: options.startsOn,
    endsOn: options.endsOn,
    createdBy: (options.meName ? personByName.get(options.meName) : undefined)?.id ?? firstPerson.id,
    createdAt: nowIso(),
    inviteToken: newId(),
  };

  const memberByName = new Map<string, Member>();
  const members: Member[] = plan.people.map((name) => {
    const member: Member = {
      id: newId(),
      tripId: trip.id,
      personId: (personByName.get(name) as Person).id,
      joinedAt: nowIso(),
    };
    memberByName.set(name, member);
    return member;
  });

  const segments: Segment[] = (options.segments ?? []).map((segment, index) => ({
    id: newId(),
    tripId: trip.id,
    name: segment.name,
    startsOn: segment.startsOn,
    endsOn: segment.endsOn,
    defaultCurrency: segment.defaultCurrency.toUpperCase(),
    sortOrder: index,
  }));

  const squads: Squad[] = plan.squads.map((squad, index) => ({
    id: newId(),
    tripId: trip.id,
    name: squad.name,
    memberIds: squad.members.map((name) => (memberByName.get(name) as Member).id),
    sortOrder: index,
  }));

  const expenses: Expense[] = plan.items.map((item) => {
    const payer = memberByName.get(item.payerName as string) as Member;
    const splits = [...item.perPerson.entries()]
      .map(([name, amount]) => ({
        memberId: (memberByName.get(name) as Member).id,
        weight: amount,
        amountMinor: amount,
        amountBaseMinor: amount,
      }))
      .sort((a, b) => a.memberId.localeCompare(b.memberId));

    // The engine's invariant, checked before anything is written rather than
    // trusted: a column that does not foot must not become an expense.
    const assigned = splits.reduce((sum, split) => sum + split.amountMinor, 0);
    if (assigned !== item.totalMinor) {
      throw new ImportError(
        `"${item.description}" splits to ${assigned} but its column totals ${item.totalMinor}`,
      );
    }

    const segmentId = segmentIdFor(item.spentAt, segments);
    return {
      id: newId(),
      tripId: trip.id,
      ...(segmentId !== undefined ? { segmentId } : {}),
      description: item.description,
      category: categoryFor(item.description),
      amountMinor: item.totalMinor,
      currency: trip.baseCurrency,
      fxRate: 1,
      amountBaseMinor: item.totalMinor,
      splitMethod: 'exact' as const,
      payers: [
        {
          memberId: payer.id,
          amountMinor: item.totalMinor,
          amountBaseMinor: item.totalMinor,
        },
      ],
      splits,
      spentAt: `${item.spentAt}T09:00:00.000Z`,
      isPrepaid: true,
      createdBy: payer.id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  });

  const meMember = options.meName ? memberByName.get(options.meName) : undefined;

  await store.transaction(
    'rw',
    [store.people, store.trips, store.members, store.segments, store.squads,
      store.expenses, store.claims, store.audit],
    async () => {
      if (newPeople.length > 0) await store.people.bulkAdd(newPeople);
      await store.trips.add(trip);
      await store.members.bulkAdd(members);
      if (segments.length > 0) await store.segments.bulkAdd(segments);
      if (squads.length > 0) await store.squads.bulkAdd(squads);
      await store.expenses.bulkAdd(expenses);
      await store.claims.put({
        tripId: trip.id,
        memberId: (meMember ?? (members[0] as Member)).id,
        claimedAt: nowIso(),
      });
      await store.audit.add({
        id: newId(),
        tripId: trip.id,
        entity: 'trip',
        entityId: trip.id,
        action: 'create',
        summary:
          `Imported ${expenses.length} items for ${members.length} people ` +
          `from a spreadsheet`,
        at: nowIso(),
      });
    },
  );

  return {
    trip,
    createdPeople: newPeople.length,
    reusedPeople: plan.people.length - newPeople.length,
    expenses: expenses.length,
    squads: squads.length,
  };
}
