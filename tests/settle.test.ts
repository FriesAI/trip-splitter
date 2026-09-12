import { describe, expect, it } from 'vitest';
import type { LedgerExpense, Transfer } from '../src/balance.js';
import { netBalances } from '../src/balance.js';
import {
  directDebts,
  rollUpHouseholds,
  settleUp,
  simplifyBalances,
} from '../src/settle.js';

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

describe('simplifyBalances', () => {
  it('pairs a single debtor with a single creditor', () => {
    const transfers = simplifyBalances(
      new Map([
        ['alice', 10_000],
        ['bob', -10_000],
      ]),
    );
    expect(transfers).toEqual([{ from: 'bob', to: 'alice', amountBaseMinor: 10_000 }]);
  });

  it('emits nothing when everyone is square', () => {
    expect(simplifyBalances(new Map([['alice', 0], ['bob', 0]]))).toEqual([]);
    expect(simplifyBalances(new Map())).toEqual([]);
  });

  it('clears every balance it is given', () => {
    const balances = new Map([
      ['alice', 45_000],
      ['bob', -12_000],
      ['carol', -18_000],
      ['dave', 5_000],
      ['erin', -20_000],
    ]);
    const transfers = simplifyBalances(balances);

    const settled = new Map(balances);
    for (const t of transfers) {
      settled.set(t.from, (settled.get(t.from) ?? 0) + t.amountBaseMinor);
      settled.set(t.to, (settled.get(t.to) ?? 0) - t.amountBaseMinor);
    }
    for (const [, remaining] of settled) expect(remaining).toBe(0);
  });

  it('needs at most n-1 transfers', () => {
    const balances = new Map([
      ['a', 30_000],
      ['b', 20_000],
      ['c', -10_000],
      ['d', -15_000],
      ['e', -25_000],
    ]);
    expect(simplifyBalances(balances).length).toBeLessThanOrEqual(balances.size - 1);
  });

  it('beats paying everyone back individually', () => {
    // One person fronted everything for twelve, so eleven people owe them.
    const expenses: LedgerExpense[] = [
      {
        id: 'big',
        totalBaseMinor: 120_000,
        payers: [{ memberId: 'm00', amountBaseMinor: 120_000 }],
        splits: Array.from({ length: 12 }, (_, i) => ({
          memberId: `m${String(i).padStart(2, '0')}`,
          amountBaseMinor: 10_000,
        })),
      },
    ];
    expect(settleUp(expenses)).toHaveLength(11);
    // But when the debts are spread around, consolidation wins.
    const spread = new Map(
      Array.from({ length: 12 }, (_, i) => [
        `m${String(i).padStart(2, '0')}`,
        i < 6 ? 10_000 : -10_000,
      ]),
    );
    expect(simplifyBalances(spread).length).toBeLessThanOrEqual(11);
  });

  it('is deterministic, so the settle-up screen does not reshuffle', () => {
    const balances = new Map([
      ['alice', 10_000],
      ['bob', 10_000],
      ['carol', -10_000],
      ['dave', -10_000],
    ]);
    const first = simplifyBalances(balances);
    for (let i = 0; i < 25; i += 1) {
      expect(simplifyBalances(new Map(balances))).toEqual(first);
    }
  });

  it('never invents or loses a minor unit', () => {
    const balances = new Map([
      ['a', 3_334],
      ['b', 3_333],
      ['c', -3_333],
      ['d', -3_334],
    ]);
    const transfers = simplifyBalances(balances);
    expect(sum(transfers.map((t) => t.amountBaseMinor))).toBe(6_667);
  });

  it('refuses balances that do not net to zero, rather than guessing', () => {
    expect(() => simplifyBalances(new Map([['a', 100], ['b', -99]]))).toThrow(
      /do not net to zero/,
    );
  });

  it('refuses a fractional balance', () => {
    expect(() => simplifyBalances(new Map([['a', 100.5], ['b', -100.5]]))).toThrow(
      /whole number of minor units/,
    );
  });
});

describe('directDebts', () => {
  const expenses: LedgerExpense[] = [
    {
      id: 'blue-lagoon',
      totalBaseMinor: 20_000,
      payers: [{ memberId: 'sinyin', amountBaseMinor: 20_000 }],
      splits: [
        { memberId: 'you', amountBaseMinor: 10_000 },
        { memberId: 'sinyin', amountBaseMinor: 10_000 },
      ],
    },
    {
      id: 'meal',
      totalBaseMinor: 5_000,
      payers: [{ memberId: 'you', amountBaseMinor: 5_000 }],
      splits: [
        { memberId: 'you', amountBaseMinor: 2_500 },
        { memberId: 'sinyin', amountBaseMinor: 2_500 },
      ],
    },
  ];

  it('nets each pair, giving the same RM 75 as the pairwise view', () => {
    expect(directDebts(expenses)).toEqual([
      { from: 'you', to: 'sinyin', amountBaseMinor: 7_500 },
    ]);
  });

  it('drops a pair that has settled exactly', () => {
    const transfers: Transfer[] = [
      { id: 't1', fromMemberId: 'you', toMemberId: 'sinyin', amountBaseMinor: 7_500 },
    ];
    expect(directDebts(expenses, transfers)).toEqual([]);
  });

  it('does not consolidate across the group, unlike simplifyBalances', () => {
    // a owes b, b owes c. Direct keeps two debts; simplified collapses to one.
    const chain: LedgerExpense[] = [
      {
        id: 'x',
        totalBaseMinor: 10_000,
        payers: [{ memberId: 'b', amountBaseMinor: 10_000 }],
        splits: [{ memberId: 'a', amountBaseMinor: 10_000 }],
      },
      {
        id: 'y',
        totalBaseMinor: 10_000,
        payers: [{ memberId: 'c', amountBaseMinor: 10_000 }],
        splits: [{ memberId: 'b', amountBaseMinor: 10_000 }],
      },
    ];
    expect(directDebts(chain)).toHaveLength(2);
    expect(settleUp(chain)).toEqual([{ from: 'a', to: 'c', amountBaseMinor: 10_000 }]);
  });
});

describe('rollUpHouseholds', () => {
  it('collapses a couple onto the member who receives their money', () => {
    const balances = new Map([
      ['a1', 6_000],
      ['a2', -1_000],
      ['solo', -5_000],
    ]);
    const rolled = rollUpHouseholds(
      balances,
      { a1: 'A', a2: 'A' },
      { A: 'a1' },
    );
    expect(rolled.get('a1')).toBe(5_000);
    expect(rolled.has('a2')).toBe(false);
    expect(rolled.get('solo')).toBe(-5_000);
    expect(sum([...rolled.values()])).toBe(0);
  });

  it('means a couple receives one transfer instead of two', () => {
    const balances = new Map([
      ['a1', 4_000],
      ['a2', 4_000],
      ['solo', -8_000],
    ]);
    expect(simplifyBalances(balances)).toHaveLength(2);
    expect(
      simplifyBalances(rollUpHouseholds(balances, { a1: 'A', a2: 'A' }, { A: 'a1' })),
    ).toEqual([{ from: 'solo', to: 'a1', amountBaseMinor: 8_000 }]);
  });

  it('leaves a member alone when their household has no settle-to set', () => {
    const rolled = rollUpHouseholds(new Map([['a1', 100]]), { a1: 'A' }, {});
    expect(rolled.get('a1')).toBe(100);
  });
});

describe('settleUp end to end', () => {
  it('clears a small group completely', () => {
    const expenses: LedgerExpense[] = [
      {
        id: 'e1',
        totalBaseMinor: 30_000,
        payers: [{ memberId: 'alice', amountBaseMinor: 30_000 }],
        splits: [
          { memberId: 'alice', amountBaseMinor: 10_000 },
          { memberId: 'bob', amountBaseMinor: 10_000 },
          { memberId: 'carol', amountBaseMinor: 10_000 },
        ],
      },
      {
        id: 'e2',
        totalBaseMinor: 6_000,
        payers: [{ memberId: 'bob', amountBaseMinor: 6_000 }],
        splits: [
          { memberId: 'alice', amountBaseMinor: 2_000 },
          { memberId: 'bob', amountBaseMinor: 2_000 },
          { memberId: 'carol', amountBaseMinor: 2_000 },
        ],
      },
    ];

    const transfers = settleUp(expenses);
    const settled = new Map(netBalances(expenses));
    for (const t of transfers) {
      settled.set(t.from, (settled.get(t.from) ?? 0) + t.amountBaseMinor);
      settled.set(t.to, (settled.get(t.to) ?? 0) - t.amountBaseMinor);
    }
    for (const [, remaining] of settled) expect(remaining).toBe(0);
  });
});
