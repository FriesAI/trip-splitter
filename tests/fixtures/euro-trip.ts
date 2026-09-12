/**
 * The Euro Trip fixture for engine tests.
 *
 * The trip data itself lives in src/domain/euro-trip.ts, so the app and the
 * tests assert against one copy rather than two that can drift. This module
 * adds only what the tests need on top: a ledger built from the sheet.
 */

import type { LedgerExpense } from '../../src/balance.js';
import {
  ASSUMED_PAYERS,
  SHEET_LINE_ITEMS,
} from '../../src/domain/euro-trip.js';

export {
  ALL_MEMBERS,
  ASSUMED_PAYERS,
  MEMBER_NAMES,
  SHEET_DISPLAYED_TOTALS,
  SHEET_LINE_ITEMS,
  SQUADS,
  owedPerMemberFromSheet,
} from '../../src/domain/euro-trip.js';

/**
 * Build the ledger the importer (IMP-01) would produce: one expense per sheet
 * column, amount = column sum, split method `exact`, participants = the members
 * with a non-empty cell.
 */
export function buildEuroTripLedger(
  payers: Readonly<Record<string, string>> = ASSUMED_PAYERS,
): LedgerExpense[] {
  return SHEET_LINE_ITEMS.map((item) => {
    const totalBaseMinor = item.perPersonSen * item.participants.length;
    const payer = payers[item.id];
    if (payer === undefined) throw new Error(`no payer given for ${item.id}`);
    return {
      id: item.id,
      description: item.description,
      spentAt: item.spentAt,
      totalBaseMinor,
      payers: [{ memberId: payer, amountBaseMinor: totalBaseMinor }],
      splits: [...item.participants]
        .sort((a, b) => a.localeCompare(b))
        .map((memberId) => ({ memberId, amountBaseMinor: item.perPersonSen })),
    };
  });
}
