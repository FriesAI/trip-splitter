/**
 * Seeding the local store with the real trip.
 *
 * The app opens on a working trip rather than an empty shell asking twelve
 * people to re-enter RM 116,823. This is the importer of docs/SPEC.md section
 * 11 in miniature: one expense per sheet column, split `exact`, participants
 * taken from the cells that have a value — which is what preserves all six
 * participant sets for free.
 */

import { db, newId, nowIso } from '../data/db.js';
import type {
  Expense,
  ExpenseCategory,
  Household,
  Member,
  Person,
  Segment,
  Squad,
  Trip,
} from './types.js';
import {
  ALL_MEMBERS,
  ASSUMED_PAYERS,
  MEMBER_NAMES,
  SEGMENTS,
  SHEET_LINE_ITEMS,
  SQUADS,
} from './euro-trip.js';

export const EURO_TRIP_NAME = 'Euro Trip 2026';

/** Has anything been seeded yet? */
export async function isEmpty(): Promise<boolean> {
  return (await db().trips.count()) === 0;
}

export async function seedEuroTrip(): Promise<Trip> {
  const store = db();

  const people: Person[] = ALL_MEMBERS.map((code, index) => ({
    id: `person-${code}`,
    displayName: MEMBER_NAMES[code] as string,
    colorIndex: index,
    createdAt: nowIso(),
  }));

  const trip: Trip = {
    id: 'trip-euro-2026',
    name: EURO_TRIP_NAME,
    baseCurrency: 'MYR',
    startsOn: '2026-11-22',
    endsOn: '2026-12-06',
    createdBy: 'person-KKM',
    createdAt: nowIso(),
    inviteToken: newId(),
  };

  const members: Member[] = ALL_MEMBERS.map((code) => ({
    id: `member-${code}`,
    tripId: trip.id,
    personId: `person-${code}`,
    joinedAt: nowIso(),
  }));

  const segments: Segment[] = SEGMENTS.map((segment, index) => ({
    id: `segment-${segment.key}`,
    tripId: trip.id,
    name: segment.name,
    startsOn: segment.startsOn,
    endsOn: segment.endsOn,
    defaultCurrency: segment.defaultCurrency,
    sortOrder: index,
  }));

  // The five participant sets the sheet already contains, saved so nobody has
  // to tick twelve boxes again.
  const squads: Squad[] = [
    { key: 'everyone', name: 'Everyone', members: SQUADS.everyone },
    { key: 'akureyri', name: 'Akureyri flight', members: SQUADS.akureyri },
    { key: 'second-car', name: 'Second car', members: SQUADS.secondCar },
    { key: 'long-haul', name: 'Long-haul flight', members: SQUADS.longHaul },
    { key: 'london-stay', name: 'London stay', members: SQUADS.londonStay },
  ].map((squad, index) => ({
    id: `squad-${squad.key}`,
    tripId: trip.id,
    name: `${squad.name} (${squad.members.length})`,
    memberIds: squad.members.map((code) => `member-${code}`),
    sortOrder: index,
  }));

  const expenses: Expense[] = SHEET_LINE_ITEMS.map((item) => {
    const participants = [...item.participants].sort((a, b) => a.localeCompare(b));
    const total = item.perPersonSen * participants.length;
    const payerCode = ASSUMED_PAYERS[item.id] as string;
    return {
      id: `expense-${item.id}`,
      tripId: trip.id,
      segmentId: `segment-${item.segment}`,
      description: item.description,
      category: item.category as ExpenseCategory,
      amountMinor: total,
      currency: 'MYR',
      fxRate: 1,
      amountBaseMinor: total,
      splitMethod: 'exact' as const,
      payers: [
        {
          memberId: `member-${payerCode}`,
          amountMinor: total,
          amountBaseMinor: total,
        },
      ],
      splits: participants.map((code) => ({
        memberId: `member-${code}`,
        weight: item.perPersonSen,
        amountMinor: item.perPersonSen,
        amountBaseMinor: item.perPersonSen,
      })),
      spentAt: `${item.spentAt}T09:00:00.000Z`,
      isPrepaid: true,
      createdBy: `member-${payerCode}`,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  });

  const households: Household[] = [];

  await store.transaction(
    'rw',
    [store.people, store.trips, store.members, store.households, store.segments,
      store.squads, store.expenses, store.claims, store.audit],
    async () => {
      await store.people.bulkPut(people);
      await store.trips.put(trip);
      await store.members.bulkPut(members);
      await store.households.bulkPut(households);
      await store.segments.bulkPut(segments);
      await store.squads.bulkPut(squads);
      await store.expenses.bulkPut(expenses);
      // This device is Khong Ming until somebody says otherwise.
      await store.claims.put({
        tripId: trip.id,
        memberId: 'member-KKM',
        claimedAt: nowIso(),
      });
      await store.audit.put({
        id: newId(),
        tripId: trip.id,
        entity: 'trip',
        entityId: trip.id,
        action: 'create',
        summary: `Imported ${expenses.length} booked items from the planning sheet`,
        at: nowIso(),
      });
    },
  );

  return trip;
}

/** Seed only when there is nothing there, so a reload never duplicates. */
export async function seedIfEmpty(): Promise<void> {
  if (await isEmpty()) await seedEuroTrip();
}
