import { describe, expect, it } from 'vitest';
import {
  LedgerError,
  type LedgerExpense,
  type Transfer,
  assertExpenseBalanced,
  expenseDebts,
  membersInLedger,
  netBalances,
  pairwiseNet,
} from '../src/balance.js';

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** One payer covers the whole bill, split equally between the participants. */
function onePayer(
  id: string,
  totalBaseMinor: number,
  payer: string,
  participants: readonly string[],
  extra: { description?: string; spentAt?: string } = {},
): LedgerExpense {
  const each = totalBaseMinor / participants.length;
  if (!Number.isInteger(each)) throw new Error('use a total that divides evenly in this helper');
  return {
    id,
    ...extra,
    totalBaseMinor,
    payers: [{ memberId: payer, amountBaseMinor: totalBaseMinor }],
    splits: participants.map((memberId) => ({ memberId, amountBaseMinor: each })),
  };
}

describe('assertExpenseBalanced', () => {
  it('accepts an expense where both sides foot', () => {
    expect(() => assertExpenseBalanced(onePayer('e1', 10_000, 'alice', ['alice', 'bob']))).not.toThrow();
  });

  it('rejects payers that do not sum to the total', () => {
    expect(() =>
      assertExpenseBalanced({
        id: 'e1',
        totalBaseMinor: 10_000,
        payers: [{ memberId: 'alice', amountBaseMinor: 9_000 }],
        splits: [{ memberId: 'alice', amountBaseMinor: 10_000 }],
      }),
    ).toThrow(/payers sum to 9000/);
  });

  it('rejects splits that do not sum to the total', () => {
    expect(() =>
      assertExpenseBalanced({
        id: 'e1',
        totalBaseMinor: 10_000,
        payers: [{ memberId: 'alice', amountBaseMinor: 10_000 }],
        splits: [{ memberId: 'bob', amountBaseMinor: 9_999 }],
      }),
    ).toThrow(/splits sum to 9999/);
  });
});

describe('expenseDebts', () => {
  it('has everyone but the payer owe their share', () => {
    const edges = expenseDebts(onePayer('e1', 30_000, 'alice', ['alice', 'bob', 'carol']));
    expect(edges).toEqual([
      expect.objectContaining({ from: 'bob', to: 'alice', amountBaseMinor: 10_000 }),
      expect.objectContaining({ from: 'carol', to: 'alice', amountBaseMinor: 10_000 }),
    ]);
  });

  it('creates no debt when the payer is the only participant', () => {
    expect(expenseDebts(onePayer('e1', 10_000, 'alice', ['alice']))).toEqual([]);
  });

  it('apportions each share across several payers in proportion to what they put down', () => {
    // Alice and Bob split a RM 300 deposit 200/100; cost falls on all three.
    const expense: LedgerExpense = {
      id: 'deposit',
      totalBaseMinor: 30_000,
      payers: [
        { memberId: 'alice', amountBaseMinor: 20_000 },
        { memberId: 'bob', amountBaseMinor: 10_000 },
      ],
      splits: [
        { memberId: 'alice', amountBaseMinor: 10_000 },
        { memberId: 'bob', amountBaseMinor: 10_000 },
        { memberId: 'carol', amountBaseMinor: 10_000 },
      ],
    };
    const edges = expenseDebts(expense);
    const owed = (from: string, to: string): number =>
      sum(edges.filter((e) => e.from === from && e.to === to).map((e) => e.amountBaseMinor));

    // Carol's RM 100 splits roughly two-thirds to Alice, one-third to Bob. It
    // lands on 66.66/33.34 rather than 66.67/33.33 because the apportionment is
    // exact on both margins at once: Alice's column has to come to exactly the
    // RM 200 she put down, and the leftover sen went to her in the other rows.
    expect(owed('carol', 'alice')).toBe(6_666);
    expect(owed('carol', 'bob')).toBe(3_334);
    // Bob owes Alice two-thirds of his own share; Alice owes Bob a third of hers.
    expect(owed('bob', 'alice')).toBe(6_667);
    expect(owed('alice', 'bob')).toBe(3_333);
    // Each payer's column comes to exactly what they put down.
    expect(owed('carol', 'alice') + owed('bob', 'alice') + 6_667).toBe(20_000);
    expect(owed('carol', 'bob') + owed('alice', 'bob') + 3_333).toBe(10_000);
  });

  it('reconciles with paid-minus-owed for every member, even with several payers', () => {
    const expense: LedgerExpense = {
      id: 'awkward',
      totalBaseMinor: 10_001,
      payers: [
        { memberId: 'alice', amountBaseMinor: 7_000 },
        { memberId: 'bob', amountBaseMinor: 3_001 },
      ],
      splits: [
        { memberId: 'alice', amountBaseMinor: 3_334 },
        { memberId: 'bob', amountBaseMinor: 3_334 },
        { memberId: 'carol', amountBaseMinor: 3_333 },
      ],
    };
    const edges = expenseDebts(expense);
    for (const member of ['alice', 'bob', 'carol']) {
      const paid = sum(
        expense.payers.filter((p) => p.memberId === member).map((p) => p.amountBaseMinor),
      );
      const owes = sum(expense.splits.filter((s) => s.memberId === member).map((s) => s.amountBaseMinor));
      const outgoing = sum(edges.filter((e) => e.from === member).map((e) => e.amountBaseMinor));
      const incoming = sum(edges.filter((e) => e.to === member).map((e) => e.amountBaseMinor));
      expect(incoming - outgoing).toBe(paid - owes);
    }
  });
});

describe('netBalances', () => {
  it('nets to zero across the group', () => {
    const balances = netBalances([
      onePayer('e1', 30_000, 'alice', ['alice', 'bob', 'carol']),
      onePayer('e2', 9_000, 'bob', ['alice', 'bob', 'carol']),
    ]);
    expect(sum([...balances.values()])).toBe(0);
  });

  it('credits the payer and debits the participants', () => {
    const balances = netBalances([onePayer('e1', 30_000, 'alice', ['alice', 'bob', 'carol'])]);
    expect(balances.get('alice')).toBe(20_000);
    expect(balances.get('bob')).toBe(-10_000);
    expect(balances.get('carol')).toBe(-10_000);
  });

  it('clears a debt when the debtor sends a transfer — sending raises your net', () => {
    const expenses = [onePayer('e1', 20_000, 'sinyin', ['you', 'sinyin'])];
    const before = netBalances(expenses);
    expect(before.get('you')).toBe(-10_000);
    expect(before.get('sinyin')).toBe(10_000);

    const transfers: Transfer[] = [
      { id: 't1', fromMemberId: 'you', toMemberId: 'sinyin', amountBaseMinor: 10_000 },
    ];
    const after = netBalances(expenses, transfers);
    expect(after.get('you')).toBe(0);
    expect(after.get('sinyin')).toBe(0);
  });

  it('rejects a negative or self-directed transfer', () => {
    expect(() =>
      netBalances([], [{ id: 't1', fromMemberId: 'a', toMemberId: 'b', amountBaseMinor: -1 }]),
    ).toThrow(LedgerError);
    expect(() =>
      netBalances([], [{ id: 't1', fromMemberId: 'a', toMemberId: 'a', amountBaseMinor: 100 }]),
    ).toThrow(/pays its own sender/);
  });
});

describe('pairwiseNet — the RM 75 case from the spec', () => {
  // You owe Sin Yin RM 100 from the Blue Lagoon tickets she bought for both of
  // you. Then you pay RM 50 for a meal split between the two of you, so she
  // owes you RM 25. What you actually hand over is RM 75.
  const blueLagoon = onePayer('blue-lagoon', 20_000, 'sinyin', ['you', 'sinyin'], {
    description: 'Blue Lagoon tickets',
    spentAt: '2026-11-25',
  });
  const meal = onePayer('meal', 5_000, 'you', ['you', 'sinyin'], {
    description: 'Dinner in Reykjavik',
    spentAt: '2026-11-26',
  });

  it('nets RM 100 against RM 25 to give RM 75', () => {
    const result = pairwiseNet('you', 'sinyin', [blueLagoon, meal]);
    expect(result.aOwesB).toBe(10_000);
    expect(result.bOwesA).toBe(2_500);
    expect(result.netBaseMinor).toBe(7_500);
  });

  it('shows the derivation, not just the answer', () => {
    const result = pairwiseNet('you', 'sinyin', [blueLagoon, meal]);
    expect(result.components).toEqual([
      expect.objectContaining({
        source: 'expense',
        id: 'blue-lagoon',
        description: 'Blue Lagoon tickets',
        amountBaseMinor: 10_000,
      }),
      expect.objectContaining({
        source: 'expense',
        id: 'meal',
        description: 'Dinner in Reykjavik',
        amountBaseMinor: -2_500,
      }),
    ]);
    // The components are the number: they sum to the net exactly.
    expect(sum(result.components.map((c) => c.amountBaseMinor))).toBe(result.netBaseMinor);
  });

  it('orders the derivation chronologically', () => {
    const result = pairwiseNet('you', 'sinyin', [meal, blueLagoon]);
    expect(result.components.map((c) => c.id)).toEqual(['blue-lagoon', 'meal']);
  });

  it('flips sign when the pair is read the other way round', () => {
    const forward = pairwiseNet('you', 'sinyin', [blueLagoon, meal]);
    const reverse = pairwiseNet('sinyin', 'you', [blueLagoon, meal]);
    expect(reverse.netBaseMinor).toBe(-forward.netBaseMinor);
  });

  it('agrees with the group balance when only these two are involved', () => {
    const balances = netBalances([blueLagoon, meal]);
    const result = pairwiseNet('you', 'sinyin', [blueLagoon, meal]);
    expect(balances.get('you')).toBe(-result.netBaseMinor);
  });

  it('reduces the net once the RM 75 is actually paid', () => {
    const transfers: Transfer[] = [
      {
        id: 't1',
        fromMemberId: 'you',
        toMemberId: 'sinyin',
        amountBaseMinor: 7_500,
        paidAt: '2026-12-07',
      },
    ];
    const result = pairwiseNet('you', 'sinyin', [blueLagoon, meal], transfers);
    expect(result.netBaseMinor).toBe(0);
    expect(result.components).toHaveLength(3);
    expect(sum(result.components.map((c) => c.amountBaseMinor))).toBe(0);
  });

  it('handles a partial payment', () => {
    const transfers: Transfer[] = [
      { id: 't1', fromMemberId: 'you', toMemberId: 'sinyin', amountBaseMinor: 5_000 },
    ];
    expect(pairwiseNet('you', 'sinyin', [blueLagoon, meal], transfers).netBaseMinor).toBe(2_500);
  });

  it('ignores expenses the pair is not both part of', () => {
    const unrelated = onePayer('unrelated', 10_000, 'joel', ['joel', 'dexter']);
    const result = pairwiseNet('you', 'sinyin', [blueLagoon, meal, unrelated]);
    expect(result.netBaseMinor).toBe(7_500);
  });

  it('refuses to net someone against themselves', () => {
    expect(() => pairwiseNet('you', 'you', [])).toThrow(LedgerError);
  });
});

describe('membersInLedger', () => {
  it('finds everyone who paid, owes, or moved money, sorted', () => {
    const members = membersInLedger(
      [onePayer('e1', 10_000, 'carol', ['alice', 'bob'])],
      [{ id: 't1', fromMemberId: 'dave', toMemberId: 'carol', amountBaseMinor: 100 }],
    );
    expect(members).toEqual(['alice', 'bob', 'carol', 'dave']);
  });
});
