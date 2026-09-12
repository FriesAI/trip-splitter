/**
 * The Euro Trip, as the group's planning spreadsheet records it.
 *
 * Read from the sheet on 2026-09-09. This is the canonical copy: the app seeds
 * from it and the engine tests assert against it, so there is one place to
 * correct when the group answers the open questions.
 *
 * Amounts are in sen. Two things to know:
 *
 *   1. The sheet records who OWES but never who PAID. `ASSUMED_PAYERS` is a
 *      labelled placeholder, not fact — see docs/SPEC.md open question 2.
 *   2. The sheet's displayed per-person totals are each one sen below the sum
 *      of that person's displayed line items, from hidden decimals in a shared
 *      column. `SHEET_DISPLAYED_TOTALS` keeps that pinned.
 */

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

export const ALL_MEMBERS: readonly string[] = Object.keys(MEMBER_NAMES).sort((a, b) =>
  a.localeCompare(b),
);

/** The six participant sets the sheet actually contains. */
export const SQUADS = {
  everyone: ALL_MEMBERS,
  akureyri: ALL_MEMBERS.filter((m) => m !== 'SL' && m !== 'SV'),
  secondCar: ['LTW', 'CYH', 'YSY', 'KKM', 'DLJ', 'JGZ', 'CCL', 'LCY'],
  longHaul: ['CYH', 'YSY', 'KKM', 'DLJ', 'JGZ', 'CCL', 'LCY'],
  londonStay: ['YSY', 'KKM', 'DLJ', 'JGZ', 'CCL', 'LCY'],
} as const;

export type SegmentKey = 'london' | 'iceland' | 'paris' | 'transit';

export interface SheetLineItem {
  id: string;
  description: string;
  spentAt: string;
  /** Per-person amount in sen, exactly as the sheet displays it. */
  perPersonSen: number;
  participants: readonly string[];
  segment: SegmentKey;
  category:
    | 'accommodation'
    | 'transport'
    | 'activity'
    | 'food'
    | 'fuel'
    | 'groceries'
    | 'shopping'
    | 'fees'
    | 'other';
}

/**
 * The thirteen priced line items. Paris — Airbnb 3-5 Dec, Disneyland 5 Dec and
 * the 5-6 Dec hotel — has columns in the sheet but no amounts yet.
 */
export const SHEET_LINE_ITEMS: readonly SheetLineItem[] = [
  {
    id: 'london-aparthotel',
    description: 'London Aparthotel',
    spentAt: '2026-11-22',
    perPersonSen: 103_364,
    participants: SQUADS.londonStay,
    segment: 'london',
    category: 'accommodation',
  },
  {
    id: 'longhaul-flight',
    description: 'Flight KUL › LDN › ICE › PARIS › KUL',
    spentAt: '2026-11-22',
    perPersonSen: 595_500,
    participants: SQUADS.longHaul,
    segment: 'transit',
    category: 'transport',
  },
  {
    id: 'blue-lagoon',
    description: 'Blue Lagoon',
    spentAt: '2026-11-25',
    perPersonSen: 57_249,
    participants: SQUADS.everyone,
    segment: 'iceland',
    category: 'activity',
  },
  {
    id: 'car-main',
    description: 'Car rental, 25 Nov – 1 Dec',
    spentAt: '2026-11-25',
    perPersonSen: 75_397,
    participants: SQUADS.everyone,
    segment: 'iceland',
    category: 'transport',
  },
  {
    id: 'd1-candlewood',
    description: 'D1 Candlewood Suites',
    spentAt: '2026-11-25',
    perPersonSen: 36_661,
    participants: SQUADS.everyone,
    segment: 'iceland',
    category: 'accommodation',
  },
  {
    id: 'd2-seljalandsfoss',
    description: 'D2 Seljalandsfoss Horizons',
    spentAt: '2026-11-26',
    perPersonSen: 46_263,
    participants: SQUADS.everyone,
    segment: 'iceland',
    category: 'accommodation',
  },
  {
    id: 'd3-fosshotel-nupar',
    description: 'D3 Fosshotel Núpar',
    spentAt: '2026-11-27',
    perPersonSen: 45_780,
    participants: SQUADS.everyone,
    segment: 'iceland',
    category: 'accommodation',
  },
  {
    id: 'd4-glacier-lagoon',
    description: 'D4 Hótel Jökulsárlón',
    spentAt: '2026-11-28',
    perPersonSen: 84_339,
    participants: SQUADS.everyone,
    segment: 'iceland',
    category: 'accommodation',
  },
  {
    id: 'd5-gistihusid',
    description: 'D5 Gistihúsið Lake Hotel',
    spentAt: '2026-11-29',
    perPersonSen: 51_568,
    participants: SQUADS.everyone,
    segment: 'iceland',
    category: 'accommodation',
  },
  {
    id: 'd6-north-mountain',
    description: 'D6 North Mountain',
    spentAt: '2026-11-30',
    perPersonSen: 39_734,
    participants: SQUADS.everyone,
    segment: 'iceland',
    category: 'accommodation',
  },
  {
    id: 'iceland-domestic-flight',
    description: 'Iceland domestic flight, Akureyri',
    spentAt: '2026-12-01',
    perPersonSen: 56_900,
    participants: SQUADS.akureyri,
    segment: 'iceland',
    category: 'transport',
  },
  {
    id: 'car-second',
    description: 'Car rental ×2, 1–3 Dec',
    spentAt: '2026-12-01',
    perPersonSen: 41_176,
    participants: SQUADS.secondCar,
    segment: 'iceland',
    category: 'transport',
  },
  {
    id: 'd7-d9-airbnb',
    description: 'D7–D9 Airbnb Reykjavík',
    spentAt: '2026-12-01',
    perPersonSen: 62_610,
    participants: SQUADS.everyone,
    segment: 'iceland',
    category: 'accommodation',
  },
];

/** Per-person totals as the sheet DISPLAYS them, in sen. Each one sen low. */
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
 * PLACEHOLDER — the sheet does not record who paid, and the Drive voucher
 * folder shows at least four different accounts uploading bookings. Replace
 * once the group answers. Balances shown in the app are only as right as this.
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

/** True whether or not anyone has told us who paid. */
export function owedPerMemberFromSheet(): Map<string, number> {
  const owed = new Map<string, number>();
  for (const item of SHEET_LINE_ITEMS) {
    for (const memberId of item.participants) {
      owed.set(memberId, (owed.get(memberId) ?? 0) + item.perPersonSen);
    }
  }
  return owed;
}

export const SEGMENTS: readonly {
  key: SegmentKey;
  name: string;
  startsOn: string;
  endsOn: string;
  defaultCurrency: string;
}[] = [
  { key: 'london', name: 'London', startsOn: '2026-11-22', endsOn: '2026-11-25', defaultCurrency: 'GBP' },
  { key: 'iceland', name: 'Iceland', startsOn: '2026-11-25', endsOn: '2026-12-03', defaultCurrency: 'ISK' },
  { key: 'paris', name: 'Paris', startsOn: '2026-12-03', endsOn: '2026-12-06', defaultCurrency: 'EUR' },
  { key: 'transit', name: 'In transit', startsOn: '2026-11-22', endsOn: '2026-12-06', defaultCurrency: 'MYR' },
];
