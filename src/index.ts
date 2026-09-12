/**
 * Trip Splitter money engine.
 *
 * Headless and deliberately UI-free: every rule that decides what somebody owes
 * lives here, is unit-tested against the real figures from the trip's planning
 * spreadsheet, and can be reasoned about without a browser.
 *
 * See docs/SPEC.md, sections 6 (money and netting) and 7 (the smart layer).
 */

export {
  MoneyError,
  DEFAULT_DECIMALS,
  decimalsFor,
  assertMinor,
  roundHalfUp,
  parseAmount,
  formatAmount,
  convert,
  sumMinor,
} from './money.js';

export {
  SplitError,
  type SplitMethod,
  type SplitLine,
  type SplitRequest,
  allocate,
  allocateMatrix,
  splitExpense,
  remainingMinor,
  rotationFor,
} from './split.js';

export {
  LedgerError,
  type PartyAmount,
  type LedgerExpense,
  type Transfer,
  type DebtEdge,
  type PairwiseSource,
  type PairwiseComponent,
  type PairwiseNet,
  assertExpenseBalanced,
  expenseDebts,
  netBalances,
  pairwiseNet,
  membersInLedger,
} from './balance.js';

export {
  type SettlementTransfer,
  simplifyBalances,
  directDebts,
  rollUpHouseholds,
  settleUp,
} from './settle.js';
