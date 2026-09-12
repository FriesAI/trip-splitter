/**
 * The real Euro Trip planning spreadsheet, as a fixture.
 *
 * Read from the group's Google Sheet on 2026-09-09. Every per-person figure
 * below is exactly what that sheet shows, in sen (MYR minor units), so the
 * engine is tested against the numbers twelve people will actually check it
 * against rather than against invented ones.
 *
 * Two things to know about this data:
 *
 * 1. The sheet records who *owes* but never who *paid*. `ASSUMED_PAYERS` is a
 *    placeholder so the ledger can be exercised end to end — it is NOT fact.
 *    See docs/SPEC.md open question 2. Assertions that depend on who paid are
 *    marked as such; everything else holds whoever fronted the money.
 *
 * 2. The sheet's own per-person totals are each one sen BELOW the sum of that
 *    person's displayed line items, consistently across all twelve rows. That
 *    is hidden decimals in a shared column, not a typo, and
 *    `SHEET_DISPLAYED_TOTALS` captures it so the discrepancy is pinned by a
 *    test rather than rediscovered later.
 */

import type { LedgerExpense } from '../../src/balance.js';

export const MEMBER_NAMES: Readonly<Record<string, string>> = {
  CCL: 'Chua Chung Li',
  CYH: 'Chan Yong Hoay',
  DLJ: 'Dexter Lee Jia Chuen',
  JGZ: 'Joel Goh Zong Yao',
  KKM: 'Kok Khong Ming',
  LCY: 'Ling Chui Yung',
  LTW: 'Lim Thye Wei',
  SL: 'Stephenie Lee',
  SV: 'Steven',
  TCY: 'Tan Chin Yong',
  TSC: 'Teoh Siew Chin',
  YSY: 'Yap Sin Yin',
};

export const ALL_MEMBERS = Object.keys(MEMBER_NAMES).sort((a, b) => a.localeCompare(b));

/** The six participant sets the sheet actually contains. */
export const SQUADS = {
  /** Everyone: hotels, the main car, Blue Lagoon. */
  everyone: ALL_MEMBERS,
  /** Akureyri domestic flight — everyone except Stephenie and Steven. */
  akureyri: ALL_MEMBERS.filter((m) => m !== 'SL' && m !== 'SV'),
  /** Second Iceland car, 1-3 Dec. */
  secondCar: ['LTW', 'CYH', 'YSY', 'KKM', 'DLJ', 'JGZ', 'CCL', 'LCY'],
  /** Long-haul KUL > LDN > ICE > PARIS > KUL. */
  longHaul: ['CYH', 'YSY', 'KKM', 'DLJ', 'JGZ', 'CCL', 'LCY'],
  /** London Aparthotel, 22-25 Nov. */
  londonStay: ['YSY', 'KKM', 'DLJ', 'JGZ', 'CCL', 'LCY'],
} as const;

export interface SheetLineItem {
  id: string;
  description: string;
  spentAt: string;
  /** Per-person amount in sen, exactly as the sheet displays it. */
  perPersonSen: number;
  participants: readonly string[];
}

/**
 * The thirteen priced line items. Paris (Airbnb 3-5 Dec, Disneyland 5 Dec,
 * hotel 5-6 Dec) has columns in the sheet but no amounts yet, so it is absent.
 */
export const SHEET_LINE_ITEMS: readonly SheetLineItem[] = [
  {
    id: 'london-aparthotel',
    description: 'London Aparthotel, 22-25 Nov',
    spentAt: '2026-11-22',
    perPersonSen: 103_364,
    participants: SQUADS.londonStay,
  },
  {
    id: 'longhaul-flight',
    description: 'Flight KUL > LDN > ICE > PARIS > KUL',
    spentAt: '2026-11-22',
    perPersonSen: 595_500,
    participants: SQUADS.longHaul,
  },
  {
    id: 'blue-lagoon',
    description: 'Blue Lagoon',
    spentAt: '2026-11-25',
    perPersonSen: 57_249,
    participants: SQUADS.everyone,
  },
  {
    id: 'car-main',
    description: 'Car rental, 25 Nov - 1 Dec',
    spentAt: '2026-11-25',
    perPersonSen: 75_397,
    participants: SQUADS.everyone,
  },
  {
    id: 'd1-candlewood',
    description: 'D1 Candlewood Suites',
    spentAt: '2026-11-25',
    perPersonSen: 36_661,
    participants: SQUADS.everyone,
  },
  {
    id: 'd2-seljalandsfoss',
    description: 'D2 Seljalandsfoss Horizons',
    spentAt: '2026-11-26',
    perPersonSen: 46_263,
    participants: SQUADS.everyone,
  },
  {
    id: 'd3-fosshotel-nupar',
    description: 'D3 Fosshotel Nupar',
    spentAt: '2026-11-27',
    perPersonSen: 45_780,
    participants: SQUADS.everyone,
  },
  {
    id: 'd4-glacier-lagoon',
    description: 'D4 Hotel Jokulsarlon, Glacier Lagoon',
    spentAt: '2026-11-28',
    perPersonSen: 84_339,
    participants: SQUADS.everyone,
  },
  {
    id: 'd5-gistihusid',
    description: 'D5 Gistihusid Lake Hotel',
    spentAt: '2026-11-29',
    perPersonSen: 51_568,
    participants: SQUADS.everyone,
  },
  {
    id: 'd6-north-mountain',
    description: 'D6 North Mountain',
    spentAt: '2026-11-30',
    perPersonSen: 39_734,
    participants: SQUADS.everyone,
  },
  {
    id: 'iceland-domestic-flight',
    description: 'Iceland domestic flight, Akureyri',
    spentAt: '2026-12-01',
    perPersonSen: 56_900,
    participants: SQUADS.akureyri,
  },
  {
    id: 'car-second',
    description: 'Car rental x2, 1-3 Dec',
    spentAt: '2026-12-01',
    perPersonSen: 41_176,
    participants: SQUADS.secondCar,
  },
  {
    id: 'd7-d9-airbnb',
    description: 'D7-D9 Airbnb Reykjavik',
    spentAt: '2026-12-01',
    perPersonSen: 62_610,
    participants: SQUADS.everyone,
  },
];

/**
 * Per-person totals as the sheet DISPLAYS them, in sen.
 *
 * Each is one sen below the sum of that person's displayed line items. Kept
 * here so that discrepancy is asserted rather than forgotten.
 */
export const SHEET_DISPLAYED_TOTALS: Readonly<Record<string, number>> = {
  TSC: 556_500,
  TCY: 556_500,
  LTW: 597_676,
  CYH: 1_193_176,
  SL: 499_600,
  SV: 499_600,
  YSY: 1_296_540,
  KKM: 1_296_540,
  DLJ: 1_296_540,
  JGZ: 1_296_540,
  CCL: 1_296_540,
  LCY: 1_296_540,
};

/**
 * PLACEHOLDER. The sheet does not record who paid; the Drive voucher folder
 * shows at least four different accounts uploading bookings, so it was not one
 * person fronting everything. Replace once the group answers.
 *
 * Tests that assert a specific person's net balance depend on this being
 * arbitrary and say so. Tests of totals, splits and invariants do not.
 */
export const ASSUMED_PAYERS: Readonly<Record<string, string>> = {
  'london-aparthotel': 'KKM',
  'longhaul-flight': 'KKM',
  'blue-lagoon': 'TSC',
  'car-main': 'CCL',
  'd1-candlewood': 'TCY',
  'd2-seljalandsfoss': 'TCY',
  'd3-fosshotel-nupar': 'TCY',
  'd4-glacier-lagoon': 'TCY',
  'd5-gistihusid': 'TCY',
  'd6-north-mountain': 'TCY',
  'iceland-domestic-flight': 'TCY',
  'car-second': 'CCL',
  'd7-d9-airbnb': 'YSY',
};

/**
 * Build the ledger the importer (IMP-01) would produce: one expense per column,
 * amount = column sum, split method `exact`, participants = the members with a
 * non-empty cell. That is what preserves all six participant sets for free.
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

/** What each person owes, summed from the displayed line items. */
export function owedPerMemberFromSheet(): Map<string, number> {
  const owed = new Map<string, number>();
  for (const item of SHEET_LINE_ITEMS) {
    for (const memberId of item.participants) {
      owed.set(memberId, (owed.get(memberId) ?? 0) + item.perPersonSen);
    }
  }
  return owed;
}
