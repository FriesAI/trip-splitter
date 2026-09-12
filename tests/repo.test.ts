/**
 * The repository, against a real (fake-backed) IndexedDB.
 *
 * These tests care about the things the UI trusts the repository to guarantee:
 * that a saved expense foots, that deletes are recoverable, that balances
 * derived from stored rows still net to zero, and that seeding the real trip
 * reproduces the sheet.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { useTestDb } from '../src/data/db.js';
import {
  addMember,
  balancesFor,
  buildExpense,
  createTrip,
  deleteExpense,
  loadTrip,
  pairFor,
  recordTransfer,
  removeMember,
  restoreExpense,
  saveExpense,
  saveHousehold,
  settlementFor,
  type ExpenseDraft,
} from '../src/data/repo.js';
import { seedEuroTrip } from '../src/domain/seed.js';
import { owedPerMemberFromSheet } from '../src/domain/euro-trip.js';

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

let counter = 0;

beforeEach(async () => {
  counter += 1;
  const store = useTestDb(`test-db-${counter}`);
  await store.open();
});

function draftOf(overrides: Partial<ExpenseDraft> = {}): ExpenseDraft {
  return {
    tripId: 'trip-euro-2026',
    description: 'Dinner in Reykjavík',
    category: 'food',
    amountMinor: 10_000,
    currency: 'MYR',
    fxRate: 1,
    splitMethod: 'equal',
    participantIds: ['member-KKM', 'member-YSY', 'member-DLJ'],
    payerIds: ['member-KKM'],
    spentAt: '2026-11-27T19:00:00.000Z',
    ...overrides,
  };
}

describe('buildExpense', () => {
  it('splits to exactly the total and records one payer for the lot', () => {
    const expense = buildExpense(draftOf(), 'MYR');
    expect(sum(expense.splits.map((s) => s.amountMinor))).toBe(10_000);
    expect(sum(expense.payers.map((p) => p.amountMinor))).toBe(10_000);
    expect(expense.payers).toHaveLength(1);
  });

  it('foots in the base currency as well as the original', () => {
    // ISK 14,900 at 0.0321 is RM 478.29, across three people.
    const expense = buildExpense(
      draftOf({ amountMinor: 14_900, currency: 'ISK', fxRate: 0.0321 }),
      'MYR',
    );
    expect(expense.amountBaseMinor).toBe(47_829);
    expect(sum(expense.splits.map((s) => s.amountMinor))).toBe(14_900);
    expect(sum(expense.splits.map((s) => s.amountBaseMinor))).toBe(47_829);
  });

  it('keeps exact splits exactly as entered', () => {
    const expense = buildExpense(
      draftOf({
        splitMethod: 'exact',
        exact: { 'member-KKM': 5_000, 'member-YSY': 3_000, 'member-DLJ': 2_000 },
      }),
      'MYR',
    );
    const byMember = new Map(expense.splits.map((s) => [s.memberId, s.amountMinor]));
    expect(byMember.get('member-KKM')).toBe(5_000);
    expect(byMember.get('member-YSY')).toBe(3_000);
    expect(byMember.get('member-DLJ')).toBe(2_000);
  });

  it('refuses exact splits that do not foot', () => {
    expect(() =>
      buildExpense(
        draftOf({
          splitMethod: 'exact',
          exact: { 'member-KKM': 5_000, 'member-YSY': 3_000, 'member-DLJ': 1_000 },
        }),
        'MYR',
      ),
    ).toThrow(/1000 unassigned/);
  });

  it('refuses multiple payers whose amounts do not foot', () => {
    expect(() =>
      buildExpense(
        draftOf({
          payerIds: ['member-KKM', 'member-YSY'],
          payerAmounts: { 'member-KKM': 6_000, 'member-YSY': 3_000 },
        }),
        'MYR',
      ),
    ).toThrow(/payers sum to 9000/);
  });

  it('accepts multiple payers that do foot, in base currency too', () => {
    const expense = buildExpense(
      draftOf({
        amountMinor: 14_900,
        currency: 'ISK',
        fxRate: 0.0321,
        payerIds: ['member-KKM', 'member-YSY'],
        payerAmounts: { 'member-KKM': 10_000, 'member-YSY': 4_900 },
      }),
      'MYR',
    );
    expect(sum(expense.payers.map((p) => p.amountMinor))).toBe(14_900);
    expect(sum(expense.payers.map((p) => p.amountBaseMinor))).toBe(expense.amountBaseMinor);
  });
});

describe('seeding the real trip', () => {
  it('loads twelve members, thirteen expenses and five squads', async () => {
    const trip = await seedEuroTrip();
    const snapshot = await loadTrip(trip.id);
    expect(snapshot).toBeDefined();
    expect(snapshot?.members).toHaveLength(12);
    expect(snapshot?.expenses).toHaveLength(13);
    expect(snapshot?.squads).toHaveLength(5);
    expect(snapshot?.people.size).toBe(12);
  });

  it('totals RM 116,823.04 and nets to zero', async () => {
    const trip = await seedEuroTrip();
    const snapshot = await loadTrip(trip.id);
    if (!snapshot) throw new Error('seed failed');

    expect(sum(snapshot.expenses.map((e) => e.amountBaseMinor))).toBe(11_682_304);
    const balances = balancesFor(snapshot);
    expect(balances.size).toBe(12);
    expect(sum([...balances.values()])).toBe(0);
  });

  it('charges each member what the sheet says they owe', async () => {
    const trip = await seedEuroTrip();
    const snapshot = await loadTrip(trip.id);
    if (!snapshot) throw new Error('seed failed');

    const owedFromSheet = owedPerMemberFromSheet();
    const owedFromStore = new Map<string, number>();
    for (const expense of snapshot.expenses) {
      for (const split of expense.splits) {
        owedFromStore.set(
          split.memberId,
          (owedFromStore.get(split.memberId) ?? 0) + split.amountBaseMinor,
        );
      }
    }
    for (const [code, expected] of owedFromSheet) {
      expect(owedFromStore.get(`member-${code}`)).toBe(expected);
    }
  });

  it('settles the whole trip with at most eleven payments', async () => {
    const trip = await seedEuroTrip();
    const snapshot = await loadTrip(trip.id);
    if (!snapshot) throw new Error('seed failed');

    const transfers = settlementFor(snapshot);
    expect(transfers.length).toBeLessThanOrEqual(11);

    const settled = new Map(balancesFor(snapshot));
    for (const t of transfers) {
      settled.set(t.from, (settled.get(t.from) ?? 0) + t.amountBaseMinor);
      settled.set(t.to, (settled.get(t.to) ?? 0) - t.amountBaseMinor);
    }
    for (const [, remaining] of settled) expect(remaining).toBe(0);
  });

  it('does not seed twice', async () => {
    await seedEuroTrip();
    await seedEuroTrip();
    const snapshot = await loadTrip('trip-euro-2026');
    expect(snapshot?.expenses).toHaveLength(13);
    expect(snapshot?.members).toHaveLength(12);
  });
});

describe('saving, deleting and restoring', () => {
  it('adds an expense and moves the balances', async () => {
    const trip = await seedEuroTrip();
    const before = balancesFor((await loadTrip(trip.id)) ?? (() => { throw new Error(); })());

    await saveExpense(draftOf(), 'MYR');
    const after = await loadTrip(trip.id);
    if (!after) throw new Error('reload failed');

    expect(after.expenses).toHaveLength(14);
    const balances = balancesFor(after);
    expect(sum([...balances.values()])).toBe(0);
    // The payer is up by what the other two owe them.
    expect((balances.get('member-KKM') ?? 0) - (before.get('member-KKM') ?? 0)).toBe(6_667);
  });

  it('hides a deleted expense but keeps it recoverable', async () => {
    const trip = await seedEuroTrip();
    const saved = await saveExpense(draftOf(), 'MYR');

    await deleteExpense(saved.id, 'member-KKM');
    const afterDelete = await loadTrip(trip.id);
    expect(afterDelete?.expenses.some((e) => e.id === saved.id)).toBe(false);
    expect(afterDelete?.expenses).toHaveLength(13);

    await restoreExpense(saved.id, 'member-KKM');
    const afterRestore = await loadTrip(trip.id);
    expect(afterRestore?.expenses.some((e) => e.id === saved.id)).toBe(true);
  });

  it('records who changed what', async () => {
    const trip = await seedEuroTrip();
    const saved = await saveExpense(draftOf(), 'MYR');
    await deleteExpense(saved.id, 'member-KKM');

    const { db } = await import('../src/data/db.js');
    const entries = await db().audit.where('tripId').equals(trip.id).toArray();
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('create');
    expect(actions).toContain('delete');
  });

  it('edits in place rather than duplicating', async () => {
    const trip = await seedEuroTrip();
    const saved = await saveExpense(draftOf(), 'MYR');
    await saveExpense(
      draftOf({ id: saved.id, description: 'Lunch instead', amountMinor: 6_000 }),
      'MYR',
    );

    const snapshot = await loadTrip(trip.id);
    expect(snapshot?.expenses).toHaveLength(14);
    const edited = snapshot?.expenses.find((e) => e.id === saved.id);
    expect(edited?.description).toBe('Lunch instead');
    expect(edited?.amountMinor).toBe(6_000);
    expect(edited?.createdAt).toBe(saved.createdAt);
  });
});

describe('transfers', () => {
  it('clears a pair once the netted amount is paid', async () => {
    const trip = await seedEuroTrip();
    await saveExpense(
      draftOf({ participantIds: ['member-KKM', 'member-YSY'], amountMinor: 10_000 }),
      'MYR',
    );

    let snapshot = await loadTrip(trip.id);
    if (!snapshot) throw new Error('reload failed');
    const before = pairFor(snapshot, 'member-YSY', 'member-KKM');
    expect(before.netBaseMinor).not.toBe(0);

    await recordTransfer({
      tripId: trip.id,
      fromMemberId: 'member-YSY',
      toMemberId: 'member-KKM',
      amountBaseMinor: before.netBaseMinor,
      method: 'bank',
    });

    snapshot = await loadTrip(trip.id);
    if (!snapshot) throw new Error('reload failed');
    expect(pairFor(snapshot, 'member-YSY', 'member-KKM').netBaseMinor).toBe(0);
  });

  it('refuses a transfer to yourself or for nothing', async () => {
    const trip = await seedEuroTrip();
    await expect(
      recordTransfer({
        tripId: trip.id,
        fromMemberId: 'member-KKM',
        toMemberId: 'member-KKM',
        amountBaseMinor: 100,
        method: 'bank',
      }),
    ).rejects.toThrow(/two different people/);

    await expect(
      recordTransfer({
        tripId: trip.id,
        fromMemberId: 'member-KKM',
        toMemberId: 'member-YSY',
        amountBaseMinor: 0,
        method: 'bank',
      }),
    ).rejects.toThrow(/positive amount/);
  });
});

describe('members and households', () => {
  it('adds a member', async () => {
    const trip = await seedEuroTrip();
    await addMember(trip.id, 'Nadia');
    const snapshot = await loadTrip(trip.id);
    expect(snapshot?.members).toHaveLength(13);
    expect([...(snapshot?.people.values() ?? [])].some((p) => p.displayName === 'Nadia')).toBe(true);
  });

  it('refuses to remove someone who appears in expenses', async () => {
    const trip = await seedEuroTrip();
    await expect(removeMember('member-YSY')).rejects.toThrow(/appears in expenses/);
    const snapshot = await loadTrip(trip.id);
    expect(snapshot?.members).toHaveLength(12);
  });

  it('removes someone who is not involved in anything', async () => {
    const trip = await seedEuroTrip();
    const added = await addMember(trip.id, 'Nadia');
    await removeMember(added.id);
    const snapshot = await loadTrip(trip.id);
    expect(snapshot?.members).toHaveLength(12);
  });

  it('pairs a couple and settles them as one', async () => {
    const trip = await seedEuroTrip();
    await saveHousehold(
      {
        id: 'household-1',
        tripId: trip.id,
        name: 'Sin Yin & Khong Ming',
        settleToMemberId: 'member-KKM',
      },
      ['member-KKM', 'member-YSY'],
    );

    const snapshot = await loadTrip(trip.id);
    if (!snapshot) throw new Error('reload failed');
    expect(snapshot.members.filter((m) => m.householdId === 'household-1')).toHaveLength(2);

    const perPerson = settlementFor(snapshot);
    const perHousehold = settlementFor(snapshot, { byHousehold: true });
    // Rolling the couple together can only reduce the number of payments.
    expect(perHousehold.length).toBeLessThanOrEqual(perPerson.length);
    expect(perHousehold.some((t) => t.from === 'member-YSY' || t.to === 'member-YSY')).toBe(false);
  });
});

describe('creating a trip', () => {
  it('creates a trip with its people, an Everyone squad and a claim', async () => {
    const trip = await createTrip({
      name: 'Japan 2027',
      baseCurrency: 'myr',
      startsOn: '2027-03-01',
      endsOn: '2027-03-10',
      memberNames: ['Alice', 'Bob', ' ', 'Carol'],
    });

    expect(trip.baseCurrency).toBe('MYR');
    const snapshot = await loadTrip(trip.id);
    expect(snapshot?.members).toHaveLength(3);
    expect(snapshot?.squads).toHaveLength(1);
    expect(snapshot?.squads[0]?.name).toBe('Everyone (3)');
    expect(snapshot?.claim).toBeDefined();
  });

  it('refuses a trip with no name or nobody in it', async () => {
    await expect(
      createTrip({
        name: '  ',
        baseCurrency: 'MYR',
        startsOn: '2027-03-01',
        endsOn: '2027-03-10',
        memberNames: ['Alice'],
      }),
    ).rejects.toThrow(/needs a name/);

    await expect(
      createTrip({
        name: 'Nowhere',
        baseCurrency: 'MYR',
        startsOn: '2027-03-01',
        endsOn: '2027-03-10',
        memberNames: [],
      }),
    ).rejects.toThrow(/at least one member/);
  });

  it('keeps trips separate', async () => {
    const euro = await seedEuroTrip();
    const japan = await createTrip({
      name: 'Japan 2027',
      baseCurrency: 'MYR',
      startsOn: '2027-03-01',
      endsOn: '2027-03-10',
      memberNames: ['Alice', 'Bob'],
    });

    const japanSnapshot = await loadTrip(japan.id);
    expect(japanSnapshot?.expenses).toHaveLength(0);
    expect(japanSnapshot?.members).toHaveLength(2);

    const euroSnapshot = await loadTrip(euro.id);
    expect(euroSnapshot?.expenses).toHaveLength(13);
    expect(euroSnapshot?.members).toHaveLength(12);
  });
});
