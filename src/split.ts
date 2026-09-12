/**
 * Splitting an expense across people.
 *
 * The single invariant everything else rests on: the amounts handed out always
 * sum to exactly the expense total. Not approximately — exactly. A sen that
 * goes missing here becomes a balance nobody can reconcile later, which is how
 * a shared spreadsheet loses the group's trust.
 */

import { MoneyError, assertMinor, sumMinor } from './money.js';

export class SplitError extends Error {
  override readonly name = 'SplitError';
}

export type SplitMethod = 'equal' | 'shares' | 'percent' | 'exact' | 'household';

export interface SplitLine {
  memberId: string;
  amountMinor: number;
  /** The weight that produced this line, for showing the user why. */
  weight: number;
}

export interface SplitRequest {
  totalMinor: number;
  /** Who the expense is split between. Order is irrelevant; results are sorted. */
  participants: readonly string[];
  method: SplitMethod;
  /** `shares`: whole-number weights. A twin room counts 2, a single 1. */
  shares?: Readonly<Record<string, number>>;
  /** `percent`: must sum to 100. */
  percents?: Readonly<Record<string, number>>;
  /** `exact`: minor units per member, must sum to the total. */
  exact?: Readonly<Record<string, number>>;
  /** `household`: member -> household id. Members without one are their own. */
  householdOf?: Readonly<Record<string, string | undefined>>;
  /**
   * Rotates which participant receives a leftover minor unit, so the same
   * person is not permanently the one paying the extra sen. Derive it from
   * something stable per expense, e.g. a hash of the expense id.
   */
  rotation?: number;
}

const MAX_WEIGHT_DECIMALS = 6;

/** Scale possibly-fractional weights up to integers so allocation stays exact. */
function toIntegerWeights(weights: readonly number[]): number[] {
  let maxDecimals = 0;
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new SplitError(`weights must be finite and non-negative, got ${weight}`);
    }
    const text = String(weight);
    const dot = text.indexOf('.');
    if (dot >= 0) maxDecimals = Math.max(maxDecimals, text.length - dot - 1);
  }
  if (maxDecimals > MAX_WEIGHT_DECIMALS) {
    throw new SplitError(`weights carry more than ${MAX_WEIGHT_DECIMALS} decimal places`);
  }
  const scale = 10 ** maxDecimals;
  return weights.map((weight) => Math.round(weight * scale));
}

/**
 * Distribute `totalMinor` across `weights` using the largest-remainder method.
 *
 * Every allocation is floored, then the leftover minor units go to the entries
 * with the largest fractional parts — ties broken by rotated position, so the
 * outcome is deterministic and reproducible rather than dependent on sort
 * stability. All arithmetic is integer: the fractional part is compared as a
 * numerator over the shared weight total, never as a float.
 */
export function allocate(
  totalMinor: number,
  weights: readonly number[],
  rotation = 0,
): number[] {
  assertMinor(totalMinor, 'total');
  if (weights.length === 0) {
    if (totalMinor !== 0) {
      throw new SplitError('cannot split a non-zero amount between nobody');
    }
    return [];
  }

  // Allocate the magnitude and re-apply the sign, so refunds behave symmetrically.
  const sign = totalMinor < 0 ? -1 : 1;
  const magnitude = Math.abs(totalMinor);

  const intWeights = toIntegerWeights(weights);
  const weightTotal = intWeights.reduce((a, b) => a + b, 0);
  if (weightTotal <= 0) {
    throw new SplitError('weights must include at least one positive value');
  }

  const count = intWeights.length;
  const base: number[] = new Array(count);
  const remainderNumerator: number[] = new Array(count);
  let allocated = 0;

  for (let i = 0; i < count; i += 1) {
    const numerator = magnitude * (intWeights[i] as number);
    if (!Number.isSafeInteger(numerator)) {
      throw new SplitError('amount and weights are too large to allocate exactly');
    }
    const share = Math.floor(numerator / weightTotal);
    base[i] = share;
    remainderNumerator[i] = numerator - share * weightTotal;
    allocated += share;
  }

  let leftover = magnitude - allocated;
  const offset = ((rotation % count) + count) % count;
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => {
    const diff = (remainderNumerator[b] as number) - (remainderNumerator[a] as number);
    if (diff !== 0) return diff;
    return ((a - offset + count) % count) - ((b - offset + count) % count);
  });

  for (const index of order) {
    if (leftover <= 0) break;
    base[index] = (base[index] as number) + 1;
    leftover -= 1;
  }

  return base.map((value) => value * sign);
}

/** Group participants into wallets. A member with no household is their own. */
function householdUnits(
  participants: readonly string[],
  householdOf: Readonly<Record<string, string | undefined>>,
): string[][] {
  const units = new Map<string, string[]>();
  for (const memberId of participants) {
    const key = householdOf[memberId] ?? `solo:${memberId}`;
    const members = units.get(key);
    if (members) members.push(memberId);
    else units.set(key, [memberId]);
  }
  // Order units by their first member so the result never depends on Map order.
  return [...units.values()].sort((a, b) =>
    (a[0] as string).localeCompare(b[0] as string),
  );
}

/**
 * Split an expense. Returns one line per participant, sorted by member id,
 * always summing to `totalMinor`.
 */
export function splitExpense(request: SplitRequest): SplitLine[] {
  const { totalMinor, method, rotation = 0 } = request;
  assertMinor(totalMinor, 'total');

  const participants = [...new Set(request.participants)].sort((a, b) =>
    a.localeCompare(b),
  );
  if (participants.length === 0) {
    throw new SplitError('an expense needs at least one participant');
  }

  if (method === 'exact') {
    const exact = request.exact;
    if (!exact) throw new SplitError("method 'exact' requires `exact` amounts");
    const lines = participants.map((memberId) => {
      const amount = exact[memberId];
      if (amount === undefined) {
        throw new SplitError(`no exact amount given for ${memberId}`);
      }
      assertMinor(amount, `exact amount for ${memberId}`);
      return { memberId, amountMinor: amount, weight: amount };
    });
    const assigned = sumMinor(lines.map((line) => line.amountMinor));
    if (assigned !== totalMinor) {
      const remaining = totalMinor - assigned;
      throw new SplitError(
        `exact amounts sum to ${assigned} but the expense is ${totalMinor} ` +
          `(${remaining > 0 ? `${remaining} unassigned` : `${-remaining} over`})`,
      );
    }
    return lines;
  }

  if (method === 'household') {
    const units = householdUnits(participants, request.householdOf ?? {});
    const perUnit = allocate(totalMinor, units.map(() => 1), rotation);
    const lines: SplitLine[] = [];
    units.forEach((members, unitIndex) => {
      const unitTotal = perUnit[unitIndex] as number;
      const within = allocate(unitTotal, members.map(() => 1), rotation);
      members.forEach((memberId, memberIndex) => {
        lines.push({
          memberId,
          amountMinor: within[memberIndex] as number,
          weight: 1 / members.length,
        });
      });
    });
    return lines.sort((a, b) => a.memberId.localeCompare(b.memberId));
  }

  let weights: number[];
  if (method === 'equal') {
    weights = participants.map(() => 1);
  } else if (method === 'shares') {
    const shares = request.shares;
    if (!shares) throw new SplitError("method 'shares' requires `shares`");
    weights = participants.map((memberId) => {
      const share = shares[memberId];
      if (share === undefined) throw new SplitError(`no share given for ${memberId}`);
      return share;
    });
  } else {
    const percents = request.percents;
    if (!percents) throw new SplitError("method 'percent' requires `percents`");
    weights = participants.map((memberId) => {
      const percent = percents[memberId];
      if (percent === undefined) throw new SplitError(`no percentage given for ${memberId}`);
      return percent;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    // User-entered percentages, so compare with a tolerance rather than exactly.
    if (Math.abs(total - 100) > 1e-9) {
      throw new SplitError(`percentages must sum to 100, got ${total}`);
    }
  }

  const amounts = allocate(totalMinor, weights, rotation);
  return participants.map((memberId, index) => ({
    memberId,
    amountMinor: amounts[index] as number,
    weight: weights[index] as number,
  }));
}

/**
 * Fill an integer matrix whose row sums and column sums are both exact.
 *
 * Needed when apportioning each participant's share across several payers: the
 * rows must sum to what each person owes AND the columns to what each payer put
 * down. Rounding row by row satisfies only the rows — one payer tends to win
 * every leftover unit and their column ends up a sen heavy, which makes the
 * figure shown between two people disagree with their headline balance.
 *
 * Method: floor the ideal proportional value in every cell, then hand out the
 * leftover units one at a time to the cell with the largest discarded fraction
 * among those whose row and column are both still short. Both margins are short
 * by the same total and every unit closes one of each, so this always
 * completes. Fractions are compared as integer numerators over the shared
 * total, never as floats.
 */
export function allocateMatrix(
  rowTotals: readonly number[],
  colTotals: readonly number[],
): number[][] {
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);
  const colSum = colTotals.reduce((a, b) => a + b, 0);
  if (grandTotal !== colSum) {
    throw new SplitError(
      `row totals sum to ${grandTotal} but column totals sum to ${colSum}`,
    );
  }
  for (const value of [...rowTotals, ...colTotals]) {
    assertMinor(value, 'matrix total');
    if (value < 0) throw new SplitError('allocateMatrix needs non-negative totals');
  }

  const rows = rowTotals.length;
  const cols = colTotals.length;
  const cells: number[][] = Array.from({ length: rows }, () =>
    new Array<number>(cols).fill(0),
  );
  if (grandTotal === 0) return cells;

  const rowShort = [...rowTotals];
  const colShort = [...colTotals];
  const candidates: Array<{ row: number; col: number; fraction: number }> = [];

  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const numerator = (rowTotals[i] as number) * (colTotals[j] as number);
      if (!Number.isSafeInteger(numerator)) {
        throw new SplitError('totals are too large to apportion exactly');
      }
      const floored = Math.floor(numerator / grandTotal);
      (cells[i] as number[])[j] = floored;
      rowShort[i] = (rowShort[i] as number) - floored;
      colShort[j] = (colShort[j] as number) - floored;
      candidates.push({ row: i, col: j, fraction: numerator - floored * grandTotal });
    }
  }

  candidates.sort((x, y) => y.fraction - x.fraction || x.row - y.row || x.col - y.col);

  let leftover = rowShort.reduce((a, b) => a + b, 0);
  // Several passes may be needed when one cell has to absorb more than one unit.
  while (leftover > 0) {
    let placed = false;
    for (const { row, col } of candidates) {
      if (leftover <= 0) break;
      if ((rowShort[row] as number) <= 0 || (colShort[col] as number) <= 0) continue;
      (cells[row] as number[])[col] = ((cells[row] as number[])[col] as number) + 1;
      rowShort[row] = (rowShort[row] as number) - 1;
      colShort[col] = (colShort[col] as number) - 1;
      leftover -= 1;
      placed = true;
    }
    if (!placed) throw new SplitError('could not apportion the remaining units exactly');
  }

  return cells;
}

/**
 * What is still unassigned, for the live "Remaining: RM 0.00" indicator that
 * gates saving an exact or share split.
 */
export function remainingMinor(
  totalMinor: number,
  assigned: Readonly<Record<string, number>>,
): number {
  assertMinor(totalMinor, 'total');
  let sum = 0;
  for (const [memberId, amount] of Object.entries(assigned)) {
    sum += assertMinor(amount, `amount for ${memberId}`);
  }
  return totalMinor - sum;
}

/** Derive a stable rotation from an expense id, so it does not need storing. */
export function rotationFor(expenseId: string): number {
  let hash = 0;
  for (let i = 0; i < expenseId.length; i += 1) {
    hash = (hash * 31 + expenseId.charCodeAt(i)) % 0x7fffffff;
  }
  return hash;
}

export { MoneyError };
