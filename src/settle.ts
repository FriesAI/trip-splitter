/**
 * Settling up.
 *
 * Twelve people generate dozens of pairwise debts. Nobody wants to make eleven
 * bank transfers, so the debt graph is reduced to the fewest payments that
 * clear every balance.
 */

import { assertMinor } from './money.js';
import {
  type LedgerExpense,
  type Transfer,
  expenseDebts,
  netBalances,
} from './balance.js';

export interface SettlementTransfer {
  from: string;
  to: string;
  amountBaseMinor: number;
}

interface Party {
  memberId: string;
  amount: number;
}

const byAmountThenId = (x: Party, y: Party): number =>
  y.amount - x.amount || x.memberId.localeCompare(y.memberId);

/**
 * Reduce net balances to a minimal-ish set of payments.
 *
 * Greedy: repeatedly match the largest creditor against the largest debtor and
 * settle the smaller of the two. This yields at most n-1 transfers, and in
 * practice around eight for a group of twelve.
 *
 * It is not provably optimal — finding the true minimum is NP-hard — but it is
 * fast, deterministic, and within a transfer or two of the best possible, which
 * nobody will notice. Ties break on member id so the same balances always
 * produce the same payment list; a settle-up screen that reshuffles itself
 * between refreshes looks broken.
 */
export function simplifyBalances(
  balances: ReadonlyMap<string, number>,
): SettlementTransfer[] {
  const creditors: Party[] = [];
  const debtors: Party[] = [];

  for (const [memberId, balance] of balances) {
    assertMinor(balance, `balance for ${memberId}`);
    if (balance > 0) creditors.push({ memberId, amount: balance });
    else if (balance < 0) debtors.push({ memberId, amount: -balance });
  }

  const total = (list: readonly Party[]): number =>
    list.reduce((sum, entry) => sum + entry.amount, 0);
  if (total(creditors) !== total(debtors)) {
    throw new Error(
      `balances do not net to zero: owed ${total(creditors)}, owing ${total(debtors)}`,
    );
  }

  creditors.sort(byAmountThenId);
  debtors.sort(byAmountThenId);

  const transfers: SettlementTransfer[] = [];
  let c = 0;
  let d = 0;

  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c] as Party;
    const debtor = debtors[d] as Party;
    const amount = Math.min(creditor.amount, debtor.amount);

    if (amount > 0) {
      transfers.push({
        from: debtor.memberId,
        to: creditor.memberId,
        amountBaseMinor: amount,
      });
    }

    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) c += 1;
    if (debtor.amount === 0) d += 1;
  }

  return transfers;
}

/**
 * Who owes whom directly, with each pair netted but nothing consolidated
 * across the group. Some people would rather pay back the person they actually
 * ate with, so both views exist and the UI toggles between them.
 *
 * Pairs are folded onto a canonical (lower id, higher id) direction and held in
 * a nested map, so member ids are never concatenated into a key and cannot
 * collide however they are formatted.
 */
export function directDebts(
  expenses: readonly LedgerExpense[],
  transfers: readonly Transfer[] = [],
): SettlementTransfer[] {
  const pairs = new Map<string, Map<string, number>>();

  const add = (from: string, to: string, amount: number): void => {
    const forward = from < to;
    const first = forward ? from : to;
    const second = forward ? to : from;
    const signed = forward ? amount : -amount;

    let inner = pairs.get(first);
    if (!inner) {
      inner = new Map<string, number>();
      pairs.set(first, inner);
    }
    inner.set(second, (inner.get(second) ?? 0) + signed);
  };

  for (const expense of expenses) {
    for (const edge of expenseDebts(expense)) {
      add(edge.from, edge.to, edge.amountBaseMinor);
    }
  }
  for (const transfer of transfers) {
    // A payment reduces what the sender owes.
    add(transfer.fromMemberId, transfer.toMemberId, -transfer.amountBaseMinor);
  }

  const result: SettlementTransfer[] = [];
  for (const [first, inner] of pairs) {
    for (const [second, net] of inner) {
      if (net === 0) continue;
      result.push(
        net > 0
          ? { from: first, to: second, amountBaseMinor: net }
          : { from: second, to: first, amountBaseMinor: -net },
      );
    }
  }

  return result.sort(
    (x, y) =>
      y.amountBaseMinor - x.amountBaseMinor ||
      x.from.localeCompare(y.from) ||
      x.to.localeCompare(y.to),
  );
}

/**
 * Collapse each household onto the member who receives its money, so a couple
 * gets one transfer instead of two. What they owe each other internally is
 * their own business and drops out here.
 */
export function rollUpHouseholds(
  balances: ReadonlyMap<string, number>,
  householdOf: Readonly<Record<string, string | undefined>>,
  settleTo: Readonly<Record<string, string>>,
): Map<string, number> {
  const rolled = new Map<string, number>();
  for (const [memberId, balance] of balances) {
    const household = householdOf[memberId];
    const target = household !== undefined ? settleTo[household] ?? memberId : memberId;
    rolled.set(target, (rolled.get(target) ?? 0) + balance);
  }
  return rolled;
}

/** Convenience: ledger straight to a payment list. */
export function settleUp(
  expenses: readonly LedgerExpense[],
  transfers: readonly Transfer[] = [],
): SettlementTransfer[] {
  return simplifyBalances(netBalances(expenses, transfers));
}
