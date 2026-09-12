/**
 * Applying an import to the store: end to end, from the real sheet's CSV to a
 * trip whose balances net to zero.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { useTestDb } from '../src/data/db.js';
import { applyImportPlan, categoryFor } from '../src/data/importer.js';
import { balancesFor, loadTrip, settlementFor } from '../src/data/repo.js';
import { planFromText, type ImportPlan } from '../src/domain/import.js';
import { seedEuroTrip } from '../src/domain/seed.js';
import { EURO_TRIP_CSV, EURO_TRIP_IMPORT_OPTIONS } from './fixtures/euro-trip-sheet.js';

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

let counter = 0;
beforeEach(async () => {
  counter += 1;
  await useTestDb(`importer-db-${counter}`).open();
});

/** The real sheet, with every item assigned a payer. */
function paidPlan(payer = 'Kok Khong MIng'): ImportPlan {
  const plan = planFromText(EURO_TRIP_CSV, { ...EURO_TRIP_IMPORT_OPTIONS });
  for (const item of plan.items) item.payerName = payer;
  return plan;
}

const APPLY = {
  tripName: 'Euro Trip 2026',
  baseCurrency: 'MYR',
  startsOn: '2026-11-22',
  endsOn: '2026-12-06',
  meName: 'Kok Khong MIng',
  segments: [
    { name: 'London', startsOn: '2026-11-22', endsOn: '2026-11-25', defaultCurrency: 'GBP' },
    { name: 'Iceland', startsOn: '2026-11-25', endsOn: '2026-12-03', defaultCurrency: 'ISK' },
    { name: 'Paris', startsOn: '2026-12-03', endsOn: '2026-12-06', defaultCurrency: 'EUR' },
  ],
};

describe('categoryFor', () => {
  it('recognises the kinds of thing a planning sheet holds', () => {
    expect(categoryFor('D4 Hótel Jökulsárlón')).toBe('accommodation');
    expect(categoryFor('D7-D9 Airbnb Reykjavík')).toBe('accommodation');
    expect(categoryFor('Car Rental x 2 Cars')).toBe('transport');
    expect(categoryFor('Iceland Domestic Flight')).toBe('transport');
    expect(categoryFor('Blue Lagoon')).toBe('activity');
    expect(categoryFor('Paris Disneyland')).toBe('activity');
    expect(categoryFor('Something nobody can classify')).toBe('other');
  });
});

describe('applying the real sheet', () => {
  it('creates the whole trip', async () => {
    const outcome = await applyImportPlan(paidPlan(), APPLY);
    expect(outcome.expenses).toBe(13);
    expect(outcome.squads).toBe(5);
    expect(outcome.createdPeople).toBe(12);
    expect(outcome.reusedPeople).toBe(0);

    const snapshot = await loadTrip(outcome.trip.id);
    expect(snapshot?.members).toHaveLength(12);
    expect(snapshot?.expenses).toHaveLength(13);
    expect(snapshot?.squads).toHaveLength(5);
    expect(snapshot?.segments).toHaveLength(3);
  });

  it('totals RM 116,823.04 and nets to zero', async () => {
    const outcome = await applyImportPlan(paidPlan(), APPLY);
    const snapshot = await loadTrip(outcome.trip.id);
    if (!snapshot) throw new Error('import failed');

    expect(sum(snapshot.expenses.map((e) => e.amountBaseMinor))).toBe(11_682_304);
    expect(sum([...balancesFor(snapshot).values()])).toBe(0);
  });

  it('matches the seeded trip expense for expense', async () => {
    // The seed is hand-written from the same sheet, so the importer reading the
    // CSV must land on identical figures. If these ever diverge, one of them is
    // wrong about the group's money.
    const seeded = await seedEuroTrip();
    const seededSnapshot = await loadTrip(seeded.id);
    const outcome = await applyImportPlan(paidPlan(), APPLY);
    const importedSnapshot = await loadTrip(outcome.trip.id);
    if (!seededSnapshot || !importedSnapshot) throw new Error('setup failed');

    const totals = (snapshot: NonNullable<typeof seededSnapshot>): number[] =>
      snapshot.expenses.map((e) => e.amountBaseMinor).sort((a, b) => a - b);
    expect(totals(importedSnapshot)).toEqual(totals(seededSnapshot));

    const owed = (snapshot: NonNullable<typeof seededSnapshot>): number[] => {
      const byMember = new Map<string, number>();
      for (const expense of snapshot.expenses) {
        for (const split of expense.splits) {
          byMember.set(
            split.memberId,
            (byMember.get(split.memberId) ?? 0) + split.amountBaseMinor,
          );
        }
      }
      return [...byMember.values()].sort((a, b) => a - b);
    };
    expect(owed(importedSnapshot)).toEqual(owed(seededSnapshot));
  });

  it('puts each expense in the right leg of the trip', async () => {
    const outcome = await applyImportPlan(paidPlan(), APPLY);
    const snapshot = await loadTrip(outcome.trip.id);
    if (!snapshot) throw new Error('import failed');

    const segmentName = new Map(snapshot.segments.map((s) => [s.id, s.name]));
    const named = (description: string): string | undefined => {
      const expense = snapshot.expenses.find((e) => e.description === description);
      return expense?.segmentId ? segmentName.get(expense.segmentId) : undefined;
    };
    expect(named('London Hotel Aparthotel')).toBe('London');
    expect(named('D4 Glacier Lagoon Hotel')).toBe('Iceland');
    expect(named('Blue Lagoon')).toBe('Iceland');
  });

  it('marks everything as booked before departure', async () => {
    const outcome = await applyImportPlan(paidPlan(), APPLY);
    const snapshot = await loadTrip(outcome.trip.id);
    expect(snapshot?.expenses.every((e) => e.isPrepaid)).toBe(true);
  });

  it('claims the device as whoever ran the import', async () => {
    const outcome = await applyImportPlan(paidPlan(), APPLY);
    const snapshot = await loadTrip(outcome.trip.id);
    const me = snapshot?.members.find((m) => m.id === snapshot.claim?.memberId);
    expect(snapshot?.people.get(me?.personId ?? '')?.displayName).toBe('Kok Khong MIng');
  });

  it('settles completely whoever paid', async () => {
    for (const payer of ['Kok Khong MIng', 'Teoh Siew Chin', 'Steven']) {
      await useTestDb(`importer-payer-${payer}-${counter}`).open();
      const outcome = await applyImportPlan(paidPlan(payer), APPLY);
      const snapshot = await loadTrip(outcome.trip.id);
      if (!snapshot) throw new Error('import failed');

      const settled = new Map(balancesFor(snapshot));
      for (const t of settlementFor(snapshot)) {
        settled.set(t.from, (settled.get(t.from) ?? 0) + t.amountBaseMinor);
        settled.set(t.to, (settled.get(t.to) ?? 0) - t.amountBaseMinor);
      }
      for (const [, remaining] of settled) expect(remaining).toBe(0);
    }
  });
});

describe('refusing to import something broken', () => {
  it('refuses while any item still has no payer', async () => {
    const plan = planFromText(EURO_TRIP_CSV, { ...EURO_TRIP_IMPORT_OPTIONS });
    for (const item of plan.items) item.payerName = 'Kok Khong MIng';
    delete plan.items[0]?.payerName;

    await expect(applyImportPlan(plan, APPLY)).rejects.toThrow(/1 item still needs a payer/);
  });

  it('refuses a payer who is not in the sheet', async () => {
    const plan = paidPlan();
    (plan.items[0] as { payerName?: string }).payerName = 'Someone Else';
    await expect(applyImportPlan(plan, APPLY)).rejects.toThrow(/is not in the sheet/);
  });

  it('writes nothing at all when it refuses', async () => {
    const plan = paidPlan();
    (plan.items[0] as { payerName?: string }).payerName = 'Someone Else';
    await expect(applyImportPlan(plan, APPLY)).rejects.toThrow();

    const { db } = await import('../src/data/db.js');
    expect(await db().trips.count()).toBe(0);
    expect(await db().people.count()).toBe(0);
    expect(await db().expenses.count()).toBe(0);
  });
});

describe('importing alongside existing data', () => {
  it('reuses people who already exist rather than duplicating them', async () => {
    await seedEuroTrip(); // creates the same twelve people
    const outcome = await applyImportPlan(paidPlan(), APPLY);

    expect(outcome.createdPeople).toBe(0);
    expect(outcome.reusedPeople).toBe(12);

    const { db } = await import('../src/data/db.js');
    expect(await db().people.count()).toBe(12);
    expect(await db().trips.count()).toBe(2);
  });

  it('keeps the imported trip separate from what was already there', async () => {
    const seeded = await seedEuroTrip();
    const outcome = await applyImportPlan(paidPlan(), APPLY);

    const seededSnapshot = await loadTrip(seeded.id);
    const importedSnapshot = await loadTrip(outcome.trip.id);
    expect(seededSnapshot?.expenses).toHaveLength(13);
    expect(importedSnapshot?.expenses).toHaveLength(13);

    const seededIds = new Set(seededSnapshot?.expenses.map((e) => e.id));
    expect(importedSnapshot?.expenses.some((e) => seededIds.has(e.id))).toBe(false);
  });

  it('matches names case-insensitively when reusing a person', async () => {
    const { db } = await import('../src/data/db.js');
    await db().people.add({
      id: 'existing-1',
      displayName: 'teoh siew chin',
      colorIndex: 0,
      createdAt: new Date().toISOString(),
    });

    const outcome = await applyImportPlan(paidPlan(), APPLY);
    expect(outcome.reusedPeople).toBe(1);
    expect(outcome.createdPeople).toBe(11);
  });
});
