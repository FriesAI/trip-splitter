/**
 * Balances and netting.
 *
 * Everything here works in the trip's *base* currency, in minor units. An
 * expense arrives with its foreign amount already converted at a rate frozen
 * when it was saved, so balances never move because a rate moved.
 *
 * One idea carries the whole module: every expense is reduced to a set of
 * directed debt edges. Group balances and the figure between two people are
 * then the same computation at different scopes, which is what makes the
 * derivation shown to the user (NET-02) provably the same number as the
 * headline balance (BAL-01).
 */

import { assertMinor, sumMinor } from './money.js';
import { allocateMatrix } from './split.js';

export class LedgerError extends Error {
  override readonly name = 'LedgerError';
}

export interface PartyAmount {
  memberId: string;
  amountBaseMinor: number;
}

export interface LedgerExpense {
  id: string;
  description?: string;
  spentAt?: string;
  totalBaseMinor: number;
  /** Who actually put money down. Must sum to the total. */
  payers: readonly PartyAmount[];
  /** Who the cost falls on. Must sum to the total. */
  splits: readonly PartyAmount[];
}

export interface Transfer {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amountBaseMinor: number;
  paidAt?: string;
}

export interface DebtEdge {
  from: string;
  to: string;
  amountBaseMinor: number;
  expenseId: string;
  description?: string;
  spentAt?: string;
}

/** Both sides of an expense must foot to its total, or it must not be saved. */
export function assertExpenseBalanced(expense: LedgerExpense): void {
  assertMinor(expense.totalBaseMinor, `expense ${expense.id} total`);
  const paid = sumMinor(expense.payers.map((p) => p.amountBaseMinor));
  const owed = sumMinor(expense.splits.map((s) => s.amountBaseMinor));
  if (paid !== expense.totalBaseMinor) {
    throw new LedgerError(
      `expense ${expense.id}: payers sum to ${paid}, total is ${expense.totalBaseMinor}`,
    );
  }
  if (owed !== expense.totalBaseMinor) {
    throw new LedgerError(
      `expense ${expense.id}: splits sum to ${owed}, total is ${expense.totalBaseMinor}`,
    );
  }
}

/**
 * Reduce one expense to debt edges.
 *
 * With a single payer this is trivial: everyone else owes their share. With
 * several payers, each participant's share is apportioned across the payers in
 * proportion to what each put down.
 *
 * That apportionment has to be exact in *both* directions — every row summing
 * to what a person owes, every column to what a payer put down — or the edges
 * stop reconciling with `paid - owed` and the figure shown between two people
 * drifts a minor unit from their headline balance. `allocateMatrix` is what
 * guarantees both margins; rounding each row independently does not.
 *
 * A member's share of their own payment is not a debt and is skipped; it
 * cancels out exactly, leaving `paid - owed` as that member's net either way.
 */
export function expenseDebts(expense: LedgerExpense): DebtEdge[] {
  assertExpenseBalanced(expense);
  const payers = expense.payers.filter((p) => p.amountBaseMinor !== 0);
  const splits = expense.splits.filter((s) => s.amountBaseMinor !== 0);
  if (payers.length === 0 || splits.length === 0) return [];

  const matrix =
    payers.length === 1
      ? splits.map((split) => [split.amountBaseMinor])
      : allocateMatrix(
          splits.map((s) => s.amountBaseMinor),
          payers.map((p) => p.amountBaseMinor),
        );

  const edges: DebtEdge[] = [];
  splits.forEach((split, row) => {
    payers.forEach((payer, col) => {
      const amount = (matrix[row] as number[])[col] as number;
      if (amount === 0 || payer.memberId === split.memberId) return;
      edges.push({
        from: split.memberId,
        to: payer.memberId,
        amountBaseMinor: amount,
        expenseId: expense.id,
        ...(expense.description !== undefined ? { description: expense.description } : {}),
        ...(expense.spentAt !== undefined ? { spentAt: expense.spentAt } : {}),
      });
    });
  });

  return edges;
}

/**
 * Net position per member: positive means the group owes them.
 *
 *   net = paid - owed + transfers sent - transfers received
 *
 * Sending a transfer *raises* your net, because it is money leaving your
 * pocket exactly like paying for an expense. Owe someone RM 75, pay them
 * RM 75, and -75 + 75 lands on zero.
 */
export function netBalances(
  expenses: readonly LedgerExpense[],
  transfers: readonly Transfer[] = [],
): Map<string, number> {
  const balances = new Map<string, number>();
  const bump = (memberId: string, delta: number): void => {
    balances.set(memberId, (balances.get(memberId) ?? 0) + delta);
  };

  for (const expense of expenses) {
    assertExpenseBalanced(expense);
    for (const payer of expense.payers) bump(payer.memberId, payer.amountBaseMinor);
    for (const split of expense.splits) bump(split.memberId, -split.amountBaseMinor);
  }

  for (const transfer of transfers) {
    assertMinor(transfer.amountBaseMinor, `transfer ${transfer.id}`);
    if (transfer.amountBaseMinor < 0) {
      throw new LedgerError(`transfer ${transfer.id} must not be negative`);
    }
    if (transfer.fromMemberId === transfer.toMemberId) {
      throw new LedgerError(`transfer ${transfer.id} pays its own sender`);
    }
    bump(transfer.fromMemberId, transfer.amountBaseMinor);
    bump(transfer.toMemberId, -transfer.amountBaseMinor);
  }

  return balances;
}

export type PairwiseSource = 'expense' | 'transfer';

export interface PairwiseComponent {
  source: PairwiseSource;
  id: string;
  description?: string;
  spentAt?: string;
  /** Signed towards `net`: positive means it increases what `a` owes `b`. */
  amountBaseMinor: number;
}

export interface PairwiseNet {
  a: string;
  b: string;
  /** Gross, before netting. */
  aOwesB: number;
  bOwesA: number;
  /** Positive means `a` owes `b`; negative means `b` owes `a`. */
  netBaseMinor: number;
  components: PairwiseComponent[];
}

/**
 * The figure between two people, with the arithmetic that produced it.
 *
 * This is the RM 75 case from the spec: owe someone RM 100, pay RM 50 for the
 * two of you, and what you actually hand over is RM 75. Returning the
 * components alongside the net is the point — a bare number gets argued with,
 * an openable one does not.
 */
export function pairwiseNet(
  a: string,
  b: string,
  expenses: readonly LedgerExpense[],
  transfers: readonly Transfer[] = [],
): PairwiseNet {
  if (a === b) throw new LedgerError('cannot net a member against themselves');

  let aOwesB = 0;
  let bOwesA = 0;
  const components: PairwiseComponent[] = [];

  for (const expense of expenses) {
    for (const edge of expenseDebts(expense)) {
      const towardsB = edge.from === a && edge.to === b;
      const towardsA = edge.from === b && edge.to === a;
      if (!towardsB && !towardsA) continue;

      if (towardsB) aOwesB += edge.amountBaseMinor;
      else bOwesA += edge.amountBaseMinor;

      components.push({
        source: 'expense',
        id: edge.expenseId,
        ...(edge.description !== undefined ? { description: edge.description } : {}),
        ...(edge.spentAt !== undefined ? { spentAt: edge.spentAt } : {}),
        amountBaseMinor: towardsB ? edge.amountBaseMinor : -edge.amountBaseMinor,
      });
    }
  }

  for (const transfer of transfers) {
    const fromA = transfer.fromMemberId === a && transfer.toMemberId === b;
    const fromB = transfer.fromMemberId === b && transfer.toMemberId === a;
    if (!fromA && !fromB) continue;

    // A transfer settles debt, so it moves the net the opposite way to a cost.
    if (fromA) aOwesB -= transfer.amountBaseMinor;
    else bOwesA -= transfer.amountBaseMinor;

    components.push({
      source: 'transfer',
      id: transfer.id,
      ...(transfer.paidAt !== undefined ? { spentAt: transfer.paidAt } : {}),
      amountBaseMinor: fromA ? -transfer.amountBaseMinor : transfer.amountBaseMinor,
    });
  }

  components.sort((x, y) => (x.spentAt ?? '').localeCompare(y.spentAt ?? ''));

  return { a, b, aOwesB, bOwesA, netBaseMinor: aOwesB - bOwesA, components };
}

/** Every member who appears anywhere in the ledger. */
export function membersInLedger(
  expenses: readonly LedgerExpense[],
  transfers: readonly Transfer[] = [],
): string[] {
  const seen = new Set<string>();
  for (const expense of expenses) {
    for (const payer of expense.payers) seen.add(payer.memberId);
    for (const split of expense.splits) seen.add(split.memberId);
  }
  for (const transfer of transfers) {
    seen.add(transfer.fromMemberId);
    seen.add(transfer.toMemberId);
  }
  return [...seen].sort((x, y) => x.localeCompare(y));
}
