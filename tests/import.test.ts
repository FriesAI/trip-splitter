import { describe, expect, it } from 'vitest';
import {
  ImportError,
  detectMatrix,
  missingPayers,
  parseDelimited,
  parseHeaderDate,
  planFromText,
} from '../src/domain/import.js';
import { formatAmount } from '../src/money.js';
import { EURO_TRIP_CSV, EURO_TRIP_IMPORT_OPTIONS } from './fixtures/euro-trip-sheet.js';
import { SHEET_DISPLAYED_TOTALS, MEMBER_NAMES } from '../src/domain/euro-trip.js';

const OPTIONS = { ...EURO_TRIP_IMPORT_OPTIONS };

describe('parseDelimited', () => {
  it('reads plain rows', () => {
    expect(parseDelimited('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps quoted commas together — thousands separators depend on it', () => {
    expect(parseDelimited('name,total\nAlice,"5,565.00"')).toEqual([
      ['name', 'total'],
      ['Alice', '5,565.00'],
    ]);
  });

  it('handles escaped quotes and newlines inside a cell', () => {
    expect(parseDelimited('a,"say ""hi""","two\nlines"')).toEqual([
      ['a', 'say "hi"', 'two\nlines'],
    ]);
  });

  it('detects tabs when they outnumber commas', () => {
    expect(parseDelimited('a\tb\tc\n1\t2\t3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('drops blank rows but keeps empty cells', () => {
    const rows = parseDelimited('a,,c\n\n\n1,,3');
    expect(rows).toEqual([
      ['a', '', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('strips a byte-order mark', () => {
    expect(parseDelimited('﻿name,total\nAlice,1')[0]).toEqual(['name', 'total']);
  });

  it('handles trailing newlines and CRLF', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseHeaderDate', () => {
  const on = (label: string): string | undefined => parseHeaderDate(label, 2026, 11);

  it('reads every date shape the real sheet uses', () => {
    expect(on('(25/11) D1 Candlewood')).toBe('2026-11-25');
    expect(on('Iceland Domestic Flight (1/12)')).toBe('2026-12-01');
    expect(on('London Hotel (22-25 Nov) Aparthotel')).toBe('2026-11-22');
    expect(on('25 Nov')).toBe('2026-11-25');
    expect(on('1-3 Dec')).toBe('2026-12-01');
  });

  it('takes the start of a range, not the end', () => {
    expect(on('Car Rental (25/11-1/12)')).toBe('2026-11-25');
    expect(on('(1-3/12) D7-D9 Airbnb')).toBe('2026-12-01');
    expect(on('25 Nov-1 Dec')).toBe('2026-11-25');
  });

  it('returns nothing when there is no date at all', () => {
    expect(on('KUL > LDN > ICE > PARIS > KUL')).toBeUndefined();
    expect(on('Blue Lagoon')).toBeUndefined();
    expect(on('Paris Disneyland')).toBeUndefined();
  });

  it('rolls a month before the start into the next year', () => {
    // A trip starting in November that runs to January.
    expect(parseHeaderDate('(3/1) New Year', 2026, 11)).toBe('2027-01-03');
    expect(parseHeaderDate('(3/12) Something', 2026, 11)).toBe('2026-12-03');
  });

  it('rejects an impossible date rather than inventing one', () => {
    expect(() => parseHeaderDate('(45/13) Nowhere', 2026, 1)).toThrow(ImportError);
  });
});

describe('detectMatrix on the real sheet', () => {
  const sheet = detectMatrix(parseDelimited(EURO_TRIP_CSV));

  it('finds the header row under the banner row of date ranges', () => {
    expect(sheet.headerRow).toBe(1);
    expect(sheet.headers[0]).toBe('Name');
  });

  it('identifies the name and total columns', () => {
    expect(sheet.nameColumn).toBe(0);
    expect(sheet.totalColumn).toBe(1);
  });

  it('finds all twelve people and nobody else', () => {
    expect(sheet.rows).toHaveLength(12);
    expect(sheet.rows[0]?.name).toBe('Teoh Siew Chin');
    expect(sheet.rows.at(-1)?.name).toBe('Ling Chui Yung');
  });

  it('keeps the banner row as a date hint per column', () => {
    // Blue Lagoon's own label carries no date; the banner above it says 25 Nov.
    expect(sheet.headers.at(-1)).toBe('Blue Lagoon');
    expect(sheet.hints.at(-1)).toBe('25 Nov');
  });
});

describe('buildImportPlan on the real sheet', () => {
  const plan = planFromText(EURO_TRIP_CSV, OPTIONS);

  it('finds the thirteen priced items and skips the three unpriced ones', () => {
    expect(plan.items).toHaveLength(13);
    expect(plan.emptyColumns).toEqual(['Paris Airbnb', 'Paris Disneyland', 'Hotel']);
  });

  it('totals RM 116,823.04', () => {
    expect(plan.grandTotalMinor).toBe(11_682_304);
    expect(formatAmount(plan.grandTotalMinor, 'MYR')).toBe('116,823.04');
  });

  it('takes each item total as the sum of its column', () => {
    const byDescription = new Map(plan.items.map((item) => [item.description, item]));
    expect(byDescription.get('KUL > LDN > ICE > PARIS > KUL')?.totalMinor).toBe(595_500 * 7);
    expect(byDescription.get('Blue Lagoon')?.totalMinor).toBe(57_249 * 12);
    expect(byDescription.get('Iceland Domestic Flight')?.totalMinor).toBe(56_900 * 10);
  });

  it('carries the participant subsets across without anybody re-picking them', () => {
    const sizes = plan.items.map((item) => item.participants.length).sort((a, b) => a - b);
    expect(sizes).toEqual([6, 7, 8, 10, 12, 12, 12, 12, 12, 12, 12, 12, 12]);

    const akureyri = plan.items.find((i) => i.description === 'Iceland Domestic Flight');
    expect(akureyri?.participants).not.toContain('Stephenie Lee');
    expect(akureyri?.participants).not.toContain('Steven');
    expect(akureyri?.participants).toHaveLength(10);
  });

  it('dates each item, falling back to the banner row when the label has none', () => {
    const byDescription = new Map(plan.items.map((item) => [item.description, item]));
    expect(byDescription.get('D1 Candlewood')?.spentAt).toBe('2026-11-25');
    expect(byDescription.get('Car Rental')?.spentAt).toBe('2026-11-25');
    expect(byDescription.get('Iceland Domestic Flight')?.spentAt).toBe('2026-12-01');
    expect(byDescription.get('London Hotel Aparthotel')?.spentAt).toBe('2026-11-22');
    // No date in the label at all — taken from the banner row above it.
    expect(byDescription.get('Blue Lagoon')?.spentAt).toBe('2026-11-25');
    // No date anywhere — falls back to the trip start.
    expect(byDescription.get('KUL > LDN > ICE > PARIS > KUL')?.spentAt).toBe('2026-11-22');
  });

  it('orders items by date', () => {
    const dates = plan.items.map((item) => item.spentAt);
    expect([...dates].sort()).toEqual(dates);
  });

  it('strips the date out of the description but keeps the name', () => {
    const descriptions = plan.items.map((item) => item.description);
    expect(descriptions).toContain('D1 Candlewood');
    expect(descriptions).toContain('Car Rental x 2 Cars');
    expect(descriptions.every((d) => !/\(\d+\/\d+\)/.test(d))).toBe(true);
  });

  it('detects the five distinct participant sets as squads', () => {
    expect(plan.squads).toHaveLength(5);
    expect(plan.squads.map((squad) => squad.members.length)).toEqual([12, 10, 8, 7, 6]);
    expect(plan.squads[0]?.name).toBe('Everyone (12)');
    // The twelve-person set covers nine of the thirteen items.
    expect(plan.squads[0]?.itemCount).toBe(9);
  });

  it('gives every squad a distinct name', () => {
    const names = plan.squads.map((squad) => squad.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('catches the sheet being one sen light on every single person', () => {
    expect(plan.discrepancies).toHaveLength(12);
    for (const discrepancy of plan.discrepancies) {
      expect(discrepancy.differenceMinor).toBe(1);
    }
    const total = plan.discrepancies.reduce((sum, d) => sum + d.differenceMinor, 0);
    expect(total).toBe(12);
  });

  it('matches the declared totals recorded from the sheet', () => {
    const byCode = new Map(
      Object.entries(MEMBER_NAMES).map(([code, name]) => [name, code]),
    );
    for (const [name, declared] of plan.declaredTotals) {
      // The sheet spells one name "Kok Khong MIng"; compare case-insensitively.
      const code =
        byCode.get(name) ??
        [...byCode.entries()].find(
          ([full]) => full.toLowerCase() === name.toLowerCase(),
        )?.[1];
      expect(code, `no member matches "${name}"`).toBeDefined();
      expect(declared).toBe(SHEET_DISPLAYED_TOTALS[code as string]);
    }
  });

  it('has no payers until somebody says who paid', () => {
    expect(missingPayers(plan)).toHaveLength(13);
  });
});

describe('buildImportPlan on other shapes', () => {
  const options = { currency: 'MYR', startYear: 2026, startMonth: 1, fallbackDate: '2026-01-01' };

  it('imports a minimal sheet with no banner and no totals column', () => {
    const plan = planFromText(
      ['Name,Dinner,Taxi', 'Alice,30.00,10.00', 'Bob,30.00,', 'Carol,30.00,10.00'].join('\n'),
      options,
    );
    expect(plan.items).toHaveLength(2);
    expect(plan.items[0]?.totalMinor).toBe(9_000);
    expect(plan.items[1]?.participants).toEqual(['Alice', 'Carol']);
    expect(plan.discrepancies).toHaveLength(0);
    expect(plan.declaredTotals.size).toBe(0);
  });

  it('treats a blank cell as "not in", not as zero', () => {
    const plan = planFromText(
      ['Name,Dinner', 'Alice,30.00', 'Bob,', 'Carol,0.00'].join('\n'),
      options,
    );
    expect(plan.items[0]?.participants).toEqual(['Alice']);
    expect(plan.items[0]?.totalMinor).toBe(3_000);
  });

  it('ignores a trailing TOTAL footer row', () => {
    const plan = planFromText(
      ['Name,Dinner', 'Alice,30.00', 'Bob,30.00', 'Total,60.00'].join('\n'),
      options,
    );
    expect(plan.people).toEqual(['Alice', 'Bob']);
  });

  it('refuses a sheet with duplicate names rather than merging two people', () => {
    expect(() =>
      planFromText(['Name,Dinner', 'Alice,10.00', 'Alice,10.00'].join('\n'), options),
    ).toThrow(/share a name/);
  });

  it('refuses a sheet with no amounts anywhere', () => {
    expect(() =>
      planFromText(['Name,Dinner,Taxi', 'Alice,,', 'Bob,,'].join('\n'), options),
    ).toThrow(ImportError);
  });

  it('refuses something that is not a sheet', () => {
    expect(() => planFromText('just one line', options)).toThrow(ImportError);
  });

  it('survives a sheet whose first column is not called Name', () => {
    const plan = planFromText(
      ['Person,Dinner', 'Alice,30.00', 'Bob,30.00'].join('\n'),
      options,
    );
    expect(plan.people).toEqual(['Alice', 'Bob']);
  });
});

describe('a plan is enough to rebuild the trip', () => {
  const plan = planFromText(EURO_TRIP_CSV, OPTIONS);

  it('splits every item to exactly its column total', () => {
    for (const item of plan.items) {
      const sum = [...item.perPerson.values()].reduce((a, b) => a + b, 0);
      expect(sum).toBe(item.totalMinor);
    }
  });

  it('reproduces each person total, which is the sheet plus its one sen', () => {
    for (const [name, computed] of plan.computedTotals) {
      const declared = plan.declaredTotals.get(name);
      expect(declared).toBeDefined();
      expect(computed).toBe((declared as number) + 1);
    }
  });

  it('adds up to the same grand total either way', () => {
    const viaPeople = [...plan.computedTotals.values()].reduce((a, b) => a + b, 0);
    expect(viaPeople).toBe(plan.grandTotalMinor);
  });
});
