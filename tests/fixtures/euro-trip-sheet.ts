/**
 * The Euro Trip planning sheet as CSV, reconstructed exactly as it reads.
 *
 * Every awkward thing about the real file is preserved deliberately, because
 * those are what the importer has to survive:
 *
 *   * a banner row of date ranges ABOVE the real header row;
 *   * a Name column and a TOTAL column mixed in with the line items;
 *   * three Paris columns that are labelled but still unpriced;
 *   * thousands separators in the amounts;
 *   * blank cells meaning "not in", not "zero";
 *   * headers that carry their date in four different formats, and one
 *     ("Blue Lagoon") that carries none and must fall back to the banner row.
 */

export const EURO_TRIP_CSV = [
  ',,,25 Nov-1 Dec,1-3 Dec,22-25 Nov,25 Nov,26 Nov,27 Nov,28 Nov,29 Nov,30 Nov,1-3 Dec,,3-5 Dec,5 Dec,5-6 Dec,25 Nov',
  'Name,TOTAL,Iceland Domestic Flight (1/12),Car Rental (25/11-1/12),Car Rental (1-3/12) x 2 Cars,London Hotel (22-25 Nov) Aparthotel,(25/11) D1 Candlewood,(26/11) D2 Seljalandfoss Horizons,(27/11) D3 Fosshotel Nupar,(28/11) D4 Glacier Lagoon Hotel,(29/11) D5 Gistihusio Lake Hotel,(30/11) D6 North Mountain,(1-3/12) D7-D9 Airbnb,KUL > LDN > ICE > PARIS > KUL,Paris Airbnb,Paris Disneyland,Hotel,Blue Lagoon',
  'Teoh Siew Chin,"5,565.00",569.00,753.97,,,366.61,462.63,457.80,843.39,515.68,397.34,626.10,,,,,572.49',
  'Tan Chin Yong,"5,565.00",569.00,753.97,,,366.61,462.63,457.80,843.39,515.68,397.34,626.10,,,,,572.49',
  'Lim Thye Wei,"5,976.76",569.00,753.97,411.76,,366.61,462.63,457.80,843.39,515.68,397.34,626.10,,,,,572.49',
  'Chan Yong Hoay,"11,931.76",569.00,753.97,411.76,,366.61,462.63,457.80,843.39,515.68,397.34,626.10,"5,955.00",,,,572.49',
  'Stephenie Lee,"4,996.00",,753.97,,,366.61,462.63,457.80,843.39,515.68,397.34,626.10,,,,,572.49',
  'Steven,"4,996.00",,753.97,,,366.61,462.63,457.80,843.39,515.68,397.34,626.10,,,,,572.49',
  'Yap Sin Yin,"12,965.40",569.00,753.97,411.76,"1,033.64",366.61,462.63,457.80,843.39,515.68,397.34,626.10,"5,955.00",,,,572.49',
  'Kok Khong MIng,"12,965.40",569.00,753.97,411.76,"1,033.64",366.61,462.63,457.80,843.39,515.68,397.34,626.10,"5,955.00",,,,572.49',
  'Dexter Lee Jia Chuen,"12,965.40",569.00,753.97,411.76,"1,033.64",366.61,462.63,457.80,843.39,515.68,397.34,626.10,"5,955.00",,,,572.49',
  'Joel Goh Zong Yao,"12,965.40",569.00,753.97,411.76,"1,033.64",366.61,462.63,457.80,843.39,515.68,397.34,626.10,"5,955.00",,,,572.49',
  'Chua Chung Li,"12,965.40",569.00,753.97,411.76,"1,033.64",366.61,462.63,457.80,843.39,515.68,397.34,626.10,"5,955.00",,,,572.49',
  'Ling Chui Yung,"12,965.40",569.00,753.97,411.76,"1,033.64",366.61,462.63,457.80,843.39,515.68,397.34,626.10,"5,955.00",,,,572.49',
].join('\n');

export const EURO_TRIP_IMPORT_OPTIONS = {
  currency: 'MYR',
  startYear: 2026,
  startMonth: 11,
  fallbackDate: '2026-11-22',
} as const;
