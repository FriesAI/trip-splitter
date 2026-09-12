import { describe, expect, it } from 'vitest';
import {
  SplitError,
  allocate,
  allocateMatrix,
  remainingMinor,
  rotationFor,
  splitExpense,
} from '../src/split.js';

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

describe('allocate', () => {
  it('splits evenly when it divides cleanly', () => {
    expect(allocate(9_000, [1, 1, 1])).toEqual([3_000, 3_000, 3_000]);
  });

  it('never loses a minor unit when it does not divide cleanly', () => {
    // RM 100.00 across three is 3333.33 sen each with 1 sen left over.
    const parts = allocate(10_000, [1, 1, 1]);
    expect(sum(parts)).toBe(10_000);
    expect(parts).toEqual([3_334, 3_333, 3_333]);
  });

  it('distributes several leftover units one each, never doubling up', () => {
    const parts = allocate(10_000, [1, 1, 1, 1, 1, 1, 1]);
    expect(sum(parts)).toBe(10_000);
    const counts = new Set(parts);
    expect([...counts].sort((a, b) => a - b)).toEqual([1_428, 1_429]);
    expect(parts.filter((p) => p === 1_429)).toHaveLength(10_000 % 7);
  });

  it('honours weights', () => {
    expect(allocate(9_000, [2, 1])).toEqual([6_000, 3_000]);
    expect(sum(allocate(10_001, [3, 2, 1]))).toBe(10_001);
  });

  it('uses largest-remainder, giving the leftover to the biggest fraction', () => {
    // 100 across weights 1,1,4: exact shares are 16.67, 16.67, 66.67.
    const parts = allocate(100, [1, 1, 4]);
    expect(sum(parts)).toBe(100);
    expect(parts).toEqual([17, 17, 66]);
  });

  it('rotates which entry receives the leftover, so it is not always the first', () => {
    expect(allocate(10_000, [1, 1, 1], 0)).toEqual([3_334, 3_333, 3_333]);
    expect(allocate(10_000, [1, 1, 1], 1)).toEqual([3_333, 3_334, 3_333]);
    expect(allocate(10_000, [1, 1, 1], 2)).toEqual([3_333, 3_333, 3_334]);
    // Rotation wraps rather than throwing.
    expect(allocate(10_000, [1, 1, 1], 3)).toEqual([3_334, 3_333, 3_333]);
  });

  it('is deterministic across repeated calls', () => {
    const first = allocate(12_347, [5, 3, 2, 1], 7);
    for (let i = 0; i < 50; i += 1) {
      expect(allocate(12_347, [5, 3, 2, 1], 7)).toEqual(first);
    }
  });

  it('handles refunds symmetrically', () => {
    const parts = allocate(-10_000, [1, 1, 1]);
    expect(sum(parts)).toBe(-10_000);
    expect(parts).toEqual([-3_334, -3_333, -3_333]);
  });

  it('handles fractional weights, such as percentages', () => {
    const parts = allocate(10_000, [33.33, 33.33, 33.34]);
    expect(sum(parts)).toBe(10_000);
  });

  it('splits a whole amount to one person', () => {
    expect(allocate(4_321, [1])).toEqual([4_321]);
  });

  it('refuses weights that are all zero', () => {
    expect(() => allocate(100, [0, 0])).toThrow(SplitError);
  });

  it('refuses a negative weight', () => {
    expect(() => allocate(100, [2, -1])).toThrow(SplitError);
  });

  it('allows nobody only when there is nothing to split', () => {
    expect(allocate(0, [])).toEqual([]);
    expect(() => allocate(100, [])).toThrow(SplitError);
  });

  it('always sums to the total, across many awkward amounts', () => {
    for (let total = 0; total <= 400; total += 1) {
      for (let n = 1; n <= 12; n += 1) {
        const parts = allocate(total, new Array(n).fill(1));
        expect(sum(parts)).toBe(total);
        // No allocation differs from another by more than one minor unit.
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('allocateMatrix', () => {
  const rowsOf = (m: readonly number[][]): number[] => m.map((row) => sum(row));
  const colsOf = (m: readonly number[][]): number[] =>
    (m[0] ?? []).map((_, j) => sum(m.map((row) => row[j] as number)));

  it('degenerates to the row totals when there is a single column', () => {
    expect(allocateMatrix([3_000, 2_000], [5_000])).toEqual([[3_000], [2_000]]);
  });

  it('holds both margins exactly when nothing divides cleanly', () => {
    // This is the case that used to be off by a sen: rounding each row alone
    // gave one column 7001 against the 7000 actually paid.
    const matrix = allocateMatrix([3_334, 3_334, 3_333], [7_000, 3_001]);
    expect(rowsOf(matrix)).toEqual([3_334, 3_334, 3_333]);
    expect(colsOf(matrix)).toEqual([7_000, 3_001]);
  });

  it('stays proportional, not merely exact', () => {
    // Column one is twice column two, so every row should split about 2:1.
    const matrix = allocateMatrix([10_000, 10_000, 10_000], [20_000, 10_000]);
    for (const row of matrix) {
      expect((row[0] as number) / (row[1] as number)).toBeCloseTo(2, 1);
    }
    expect(colsOf(matrix)).toEqual([20_000, 10_000]);
  });

  it('holds both margins across many awkward shapes', () => {
    const shapes: Array<[number[], number[]]> = [
      [[1], [1]],
      [[1, 1, 1], [3]],
      [[3], [1, 1, 1]],
      [[1, 2, 3, 4], [5, 5]],
      [[7, 11, 13], [17, 14]],
      [[100_001, 1, 1], [50_001, 50_002]],
      [[1, 1, 1, 1, 1, 1, 1], [3, 4]],
      [[595_500, 103_364, 57_249], [500_000, 256_113]],
    ];
    for (const [rowTotals, colTotals] of shapes) {
      const matrix = allocateMatrix(rowTotals, colTotals);
      expect(rowsOf(matrix)).toEqual(rowTotals);
      expect(colsOf(matrix)).toEqual(colTotals);
      for (const row of matrix) {
        for (const cell of row) expect(cell).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('handles a column that is owed nothing', () => {
    const matrix = allocateMatrix([100, 100], [200, 0]);
    expect(rowsOf(matrix)).toEqual([100, 100]);
    expect(colsOf(matrix)).toEqual([200, 0]);
  });

  it('handles an all-zero problem', () => {
    expect(allocateMatrix([0, 0], [0, 0])).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it('is deterministic', () => {
    const first = allocateMatrix([3_334, 3_334, 3_333], [7_000, 3_001]);
    for (let i = 0; i < 25; i += 1) {
      expect(allocateMatrix([3_334, 3_334, 3_333], [7_000, 3_001])).toEqual(first);
    }
  });

  it('refuses margins that disagree', () => {
    expect(() => allocateMatrix([100], [99])).toThrow(/row totals sum to 100/);
  });

  it('refuses a negative total', () => {
    expect(() => allocateMatrix([-100, 200], [100])).toThrow(SplitError);
  });
});

describe('splitExpense — equal', () => {
  it('splits between the selected participants only', () => {
    const lines = splitExpense({
      totalMinor: 30_000,
      participants: ['alice', 'bob', 'carol'],
      method: 'equal',
    });
    expect(lines.map((l) => l.memberId)).toEqual(['alice', 'bob', 'carol']);
    expect(lines.map((l) => l.amountMinor)).toEqual([10_000, 10_000, 10_000]);
  });

  it('sorts by member id, so the result never depends on input order', () => {
    const a = splitExpense({
      totalMinor: 10_000,
      participants: ['carol', 'alice', 'bob'],
      method: 'equal',
    });
    const b = splitExpense({
      totalMinor: 10_000,
      participants: ['alice', 'bob', 'carol'],
      method: 'equal',
    });
    expect(a).toEqual(b);
  });

  it('ignores a duplicated participant rather than charging them twice', () => {
    const lines = splitExpense({
      totalMinor: 10_000,
      participants: ['alice', 'alice', 'bob'],
      method: 'equal',
    });
    expect(lines).toHaveLength(2);
    expect(sum(lines.map((l) => l.amountMinor))).toBe(10_000);
  });
});

describe('splitExpense — shares', () => {
  it('weights a twin room at two and a single at one', () => {
    const lines = splitExpense({
      totalMinor: 60_000,
      participants: ['alice', 'bob', 'carol'],
      method: 'shares',
      shares: { alice: 2, bob: 1, carol: 1 },
    });
    expect(lines.map((l) => l.amountMinor)).toEqual([30_000, 15_000, 15_000]);
  });

  it('refuses when a participant has no share', () => {
    expect(() =>
      splitExpense({
        totalMinor: 100,
        participants: ['alice', 'bob'],
        method: 'shares',
        shares: { alice: 1 },
      }),
    ).toThrow(/no share given for bob/);
  });
});

describe('splitExpense — percent', () => {
  it('splits by percentage', () => {
    const lines = splitExpense({
      totalMinor: 10_000,
      participants: ['alice', 'bob'],
      method: 'percent',
      percents: { alice: 60, bob: 40 },
    });
    expect(lines.map((l) => l.amountMinor)).toEqual([6_000, 4_000]);
  });

  it('refuses percentages that do not sum to 100', () => {
    expect(() =>
      splitExpense({
        totalMinor: 10_000,
        participants: ['alice', 'bob'],
        method: 'percent',
        percents: { alice: 60, bob: 30 },
      }),
    ).toThrow(/must sum to 100/);
  });
});

describe('splitExpense — exact', () => {
  it('takes the amounts as given when they foot', () => {
    const lines = splitExpense({
      totalMinor: 10_000,
      participants: ['alice', 'bob'],
      method: 'exact',
      exact: { alice: 7_000, bob: 3_000 },
    });
    expect(lines.map((l) => l.amountMinor)).toEqual([7_000, 3_000]);
  });

  it('refuses to save an unbalanced split, and says by how much', () => {
    expect(() =>
      splitExpense({
        totalMinor: 10_000,
        participants: ['alice', 'bob'],
        method: 'exact',
        exact: { alice: 7_000, bob: 2_000 },
      }),
    ).toThrow(/1000 unassigned/);

    expect(() =>
      splitExpense({
        totalMinor: 10_000,
        participants: ['alice', 'bob'],
        method: 'exact',
        exact: { alice: 7_000, bob: 4_000 },
      }),
    ).toThrow(/1000 over/);
  });

  it('refuses a fractional exact amount', () => {
    expect(() =>
      splitExpense({
        totalMinor: 10_000,
        participants: ['alice'],
        method: 'exact',
        exact: { alice: 10_000.5 },
      }),
    ).toThrow(/whole number of minor units/);
  });
});

describe('splitExpense — household, the "by couple" mode', () => {
  it('divides among wallets rather than heads', () => {
    // Six people, three couples, RM 600: RM 200 per couple, not RM 100 per head.
    const lines = splitExpense({
      totalMinor: 60_000,
      participants: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'],
      method: 'household',
      householdOf: { a1: 'A', a2: 'A', b1: 'B', b2: 'B', c1: 'C', c2: 'C' },
    });
    expect(sum(lines.map((l) => l.amountMinor))).toBe(60_000);
    // Each member carries half of their couple's RM 200.
    expect(lines.map((l) => l.amountMinor)).toEqual([
      10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
    ]);
  });

  it('charges a couple twice what a solo traveller pays', () => {
    // Couple A plus solo C: two wallets, so RM 50 each wallet.
    const lines = splitExpense({
      totalMinor: 10_000,
      participants: ['a1', 'a2', 'c1'],
      method: 'household',
      householdOf: { a1: 'A', a2: 'A' },
    });
    const byMember = new Map(lines.map((l) => [l.memberId, l.amountMinor]));
    expect(byMember.get('c1')).toBe(5_000);
    expect((byMember.get('a1') as number) + (byMember.get('a2') as number)).toBe(5_000);
    expect(sum(lines.map((l) => l.amountMinor))).toBe(10_000);
  });

  it('treats everyone as solo when no households are set', () => {
    const household = splitExpense({
      totalMinor: 10_000,
      participants: ['alice', 'bob'],
      method: 'household',
    });
    const equal = splitExpense({
      totalMinor: 10_000,
      participants: ['alice', 'bob'],
      method: 'equal',
    });
    expect(household.map((l) => l.amountMinor)).toEqual(equal.map((l) => l.amountMinor));
  });

  it('still foots exactly when wallets and members both divide awkwardly', () => {
    const lines = splitExpense({
      totalMinor: 10_001,
      participants: ['a1', 'a2', 'a3', 'b1', 'c1'],
      method: 'household',
      householdOf: { a1: 'A', a2: 'A', a3: 'A', b1: 'B' },
    });
    expect(sum(lines.map((l) => l.amountMinor))).toBe(10_001);
  });
});

describe('remainingMinor', () => {
  it('reports what is still unassigned, for the live indicator', () => {
    expect(remainingMinor(10_000, { alice: 7_000 })).toBe(3_000);
    expect(remainingMinor(10_000, { alice: 7_000, bob: 3_000 })).toBe(0);
    expect(remainingMinor(10_000, { alice: 11_000 })).toBe(-1_000);
  });
});

describe('rotationFor', () => {
  it('is stable for the same expense id and differs across ids', () => {
    expect(rotationFor('exp-1')).toBe(rotationFor('exp-1'));
    expect(rotationFor('exp-1')).not.toBe(rotationFor('exp-2'));
  });

  it('is always a non-negative integer, so allocate can use it directly', () => {
    for (const id of ['', 'a', 'blue-lagoon', 'd7-d9-airbnb']) {
      const rotation = rotationFor(id);
      expect(Number.isInteger(rotation)).toBe(true);
      expect(rotation).toBeGreaterThanOrEqual(0);
    }
  });
});
