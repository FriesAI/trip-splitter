/**
 * Importing a planning spreadsheet.
 *
 * Groups plan trips in a matrix: people down the side, booked items across the
 * top, and a cell wherever somebody is in for something. That shape already
 * encodes the participant subsets the whole app is built around, so reading it
 * straight is far better than asking twelve people to re-enter a hundred
 * thousand ringgit by hand.
 *
 * Everything here is pure. Nothing touches storage, so the awkward part — did
 * this column mean the 25th of November or the 1st of December — is testable
 * against the real sheet rather than discovered in production.
 *
 * The one thing a planning sheet never records is WHO PAID. That is asked for
 * separately; see `ImportPlan.items[].payerName`.
 */

import { MoneyError, parseAmount } from '../money.js';

export class ImportError extends Error {
  override readonly name = 'ImportError';
}

// ------------------------------------------------------------- delimited ----

/**
 * Parse CSV or TSV, honouring quoted fields, escaped quotes and newlines
 * inside cells. Small enough to own; a dependency here would be all cost.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const sep = delimiter ?? guessDelimiter(source);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] as string;

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === sep) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

function guessDelimiter(text: string): string {
  const sample = text.split('\n').slice(0, 10).join('\n');
  const tabs = (sample.match(/\t/g) ?? []).length;
  const commas = (sample.match(/,/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

// ----------------------------------------------------------------- dates ----

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Pull the first date out of a column label.
 *
 * Real headers from the trip's own sheet, all of which must work:
 *   "(25/11) D1 Candlewood"              -> 25 Nov
 *   "Car Rental (25/11-1/12)"            -> 25 Nov  (start of the range)
 *   "Car Rental (1-3/12) x 2 Cars"       -> 1 Dec   (day range, shared month)
 *   "London Hotel (22-25 Nov) Aparthotel"-> 22 Nov
 *   "Iceland Domestic Flight (1/12)"     -> 1 Dec
 *   "KUL > LDN > ICE > PARIS > KUL"      -> nothing
 */
export function parseHeaderDate(
  label: string,
  startYear: number,
  startMonth = 1,
): string | undefined {
  const text = label.replace(/[‐-―]/g, '-');

  // Order matters here. "25/11-1/12" contains "11-1/12", which reads as a day
  // range if you look for one first — and the answer comes out as 11 December
  // instead of 25 November. So match a full two-date range before anything else.
  const fullRange = /(\d{1,2})\s*\/\s*(\d{1,2})\s*-\s*\d{1,2}\s*\/\s*\d{1,2}/.exec(text);
  if (fullRange) {
    return isoFor(Number(fullRange[1]), Number(fullRange[2]), startYear, startMonth);
  }

  // "1-3/12" — a genuine day range sharing one month.
  const dayRange = /(\d{1,2})\s*-\s*(\d{1,2})\s*\/\s*(\d{1,2})/.exec(text);
  if (dayRange) {
    return isoFor(Number(dayRange[1]), Number(dayRange[3]), startYear, startMonth);
  }

  // Plain "25/11".
  const numeric = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(text);

  // "22-25 Nov" or "25 Nov".
  const named = /(\d{1,2})\s*(?:-\s*\d{1,2}\s*)?([A-Za-z]{3,4})\b/.exec(text);
  const namedMonth = named ? MONTHS[(named[2] as string).toLowerCase()] : undefined;

  if (numeric && (!named || namedMonth === undefined || numeric.index <= named.index)) {
    return isoFor(Number(numeric[1]), Number(numeric[2]), startYear, startMonth);
  }
  if (named && namedMonth !== undefined) {
    return isoFor(Number(named[1]), namedMonth, startYear, startMonth);
  }
  return undefined;
}

function isoFor(day: number, month: number, startYear: number, startMonth: number): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new ImportError(`"${day}/${month}" is not a real date`);
  }
  // A trip that runs into January belongs to the next year.
  const year = month < startMonth ? startYear + 1 : startYear;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- matrix ----

export interface DetectedSheet {
  /** Index of the row holding the column labels. */
  headerRow: number;
  /** Column holding people's names. */
  nameColumn: number;
  /** Column holding each person's declared total, if the sheet has one. */
  totalColumn?: number;
  headers: string[];
  /** Labels from any rows above the header, used as a date hint per column. */
  hints: (string | undefined)[];
  rows: { name: string; cells: string[] }[];
}

const numericish = (cell: string): boolean =>
  /^-?[\d,\s]*\d(\.\d+)?$/.test(cell.trim()) && /\d/.test(cell);

/**
 * Work out which row holds the column labels and which column holds the names.
 *
 * Planning sheets grow banner rows — a row of date ranges above the real
 * headers is normal — so the header is found by looking for the first row that
 * is followed by rows of numbers, rather than assuming row one.
 */
export function detectMatrix(grid: readonly (readonly string[])[]): DetectedSheet {
  if (grid.length < 2) throw new ImportError('that does not look like a sheet — too few rows');

  const width = Math.max(...grid.map((row) => row.length));
  // One amount is enough to make a row a person. Requiring two would reject a
  // two-column sheet outright, since each person has only one figure there.
  const isDataRow = (row: readonly string[]): boolean => row.some((cell) => numericish(cell));

  // The header is the row directly above the first person, whatever sits above
  // it — planning sheets grow banner rows of date ranges, and one of those must
  // never be mistaken for the header. An explicit "Name" column wins if present.
  const firstDataRow = grid.findIndex(isDataRow);
  if (firstDataRow < 0) throw new ImportError('no rows in that sheet had any amounts');
  if (firstDataRow === 0) {
    throw new ImportError('the first row already holds amounts — there is no header to read');
  }

  const namedRow = grid
    .slice(0, firstDataRow)
    .findIndex((row) => row.some((cell) => /^\s*names?\s*$/i.test(cell)));
  const headerRow = namedRow >= 0 ? namedRow : firstDataRow - 1;

  const headers: string[] = [];
  for (let c = 0; c < width; c += 1) headers.push(((grid[headerRow] as string[])[c] ?? '').trim());

  const nameColumn = Math.max(
    0,
    headers.findIndex((header) => /^names?$/i.test(header)),
  );
  const totalIndex = headers.findIndex((header) => /^totals?$/i.test(header));

  // Anything above the header can carry a date for a column whose own label
  // does not: the trip's sheet puts "25 Nov" over the Blue Lagoon column.
  const hints: (string | undefined)[] = new Array(width).fill(undefined);
  for (let r = 0; r < headerRow; r += 1) {
    const row = grid[r] as readonly string[];
    for (let c = 0; c < width; c += 1) {
      const cell = (row[c] ?? '').trim();
      if (cell) hints[c] = cell;
    }
  }

  const rows: { name: string; cells: string[] }[] = [];
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] as readonly string[];
    const name = (row[nameColumn] ?? '').trim();
    if (!name) continue;
    if (/^totals?$/i.test(name)) continue; // a footer row, not a person
    const cells: string[] = [];
    for (let c = 0; c < width; c += 1) cells.push((row[c] ?? '').trim());
    rows.push({ name, cells });
  }
  if (rows.length === 0) throw new ImportError('found a header but no people underneath it');

  return {
    headerRow,
    nameColumn,
    ...(totalIndex >= 0 ? { totalColumn: totalIndex } : {}),
    headers,
    hints,
    rows,
  };
}

// ------------------------------------------------------------------ plan ----

export interface ImportItem {
  /** Column index in the source sheet, so the UI can point at it. */
  column: number;
  label: string;
  description: string;
  spentAt: string;
  /** Per-person amounts in minor units, keyed by the name in the sheet. */
  perPerson: Map<string, number>;
  totalMinor: number;
  participants: string[];
  /** Answered by the person doing the import; the sheet never says. */
  payerName?: string;
}

export interface ImportDiscrepancy {
  name: string;
  declaredMinor: number;
  computedMinor: number;
  differenceMinor: number;
}

export interface DetectedSquad {
  name: string;
  members: string[];
  itemCount: number;
}

export interface ImportPlan {
  currency: string;
  people: string[];
  items: ImportItem[];
  /** Columns with a label but no amounts — still being booked. */
  emptyColumns: string[];
  grandTotalMinor: number;
  computedTotals: Map<string, number>;
  declaredTotals: Map<string, number>;
  discrepancies: ImportDiscrepancy[];
  squads: DetectedSquad[];
}

export interface ImportOptions {
  currency: string;
  /** Year the trip starts in; the sheet's dates carry no year. */
  startYear: number;
  /** Month the trip starts in, so a January column rolls into the next year. */
  startMonth?: number;
  /** Used when a column carries no date at all. */
  fallbackDate: string;
}

function cleanLabel(label: string): string {
  return label
    .replace(/\((?:\d{1,2}\s*[-/]\s*)*\d{1,2}\s*[/-]\s*\d{1,2}\)/g, '')
    .replace(/\(\d{1,2}\s*(?:-\s*\d{1,2}\s*)?[A-Za-z]{3,4}\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Read a sheet cell as minor units, or undefined when the person is not in. */
function cellAmount(cell: string, currency: string): number | undefined {
  const text = cell.trim();
  if (!text || text === '-' || text === '—') return undefined;
  if (!numericish(text)) return undefined;
  try {
    const value = parseAmount(text, currency);
    return value === 0 ? undefined : value;
  } catch (cause) {
    if (cause instanceof MoneyError) return undefined;
    throw cause;
  }
}

/**
 * Turn a detected matrix into everything needed to create a trip.
 *
 * One expense per column with amounts in it; its total is the column sum and
 * its participants are whoever has a cell. That is what carries the sheet's
 * participant subsets across without anybody re-selecting them.
 */
export function buildImportPlan(
  sheet: DetectedSheet,
  options: ImportOptions,
): ImportPlan {
  const { currency, startYear, startMonth = 1, fallbackDate } = options;
  const people = sheet.rows.map((row) => row.name);
  if (new Set(people).size !== people.length) {
    throw new ImportError('two rows share a name — names must be unique to import');
  }

  const items: ImportItem[] = [];
  const emptyColumns: string[] = [];

  for (let column = 0; column < sheet.headers.length; column += 1) {
    if (column === sheet.nameColumn || column === sheet.totalColumn) continue;
    const label = sheet.headers[column] ?? '';
    const hint = sheet.hints[column];
    if (!label && !hint) continue;

    const perPerson = new Map<string, number>();
    let totalMinor = 0;
    for (const row of sheet.rows) {
      const amount = cellAmount(row.cells[column] ?? '', currency);
      if (amount === undefined) continue;
      perPerson.set(row.name, amount);
      totalMinor += amount;
    }

    if (perPerson.size === 0) {
      if (label) emptyColumns.push(label);
      continue;
    }

    const spentAt =
      parseHeaderDate(label, startYear, startMonth) ??
      (hint ? parseHeaderDate(hint, startYear, startMonth) : undefined) ??
      fallbackDate;

    items.push({
      column,
      label,
      description: cleanLabel(label) || label || 'Imported item',
      spentAt,
      perPerson,
      totalMinor,
      participants: [...perPerson.keys()],
    });
  }

  if (items.length === 0) throw new ImportError('no columns in that sheet had any amounts');

  items.sort((a, b) => a.spentAt.localeCompare(b.spentAt) || a.column - b.column);

  const computedTotals = new Map<string, number>();
  for (const person of people) computedTotals.set(person, 0);
  for (const item of items) {
    for (const [person, amount] of item.perPerson) {
      computedTotals.set(person, (computedTotals.get(person) ?? 0) + amount);
    }
  }

  const declaredTotals = new Map<string, number>();
  const discrepancies: ImportDiscrepancy[] = [];
  if (sheet.totalColumn !== undefined) {
    for (const row of sheet.rows) {
      const declared = cellAmount(row.cells[sheet.totalColumn] ?? '', currency);
      if (declared === undefined) continue;
      declaredTotals.set(row.name, declared);
      const computed = computedTotals.get(row.name) ?? 0;
      if (declared !== computed) {
        discrepancies.push({
          name: row.name,
          declaredMinor: declared,
          computedMinor: computed,
          differenceMinor: computed - declared,
        });
      }
    }
  }

  // Distinct participant sets become squads, so nobody re-ticks twelve boxes.
  const bySignature = new Map<string, DetectedSquad>();
  for (const item of items) {
    const members = [...item.participants].sort((a, b) => a.localeCompare(b));
    const signature = members.join('');
    const existing = bySignature.get(signature);
    if (existing) existing.itemCount += 1;
    else bySignature.set(signature, { name: '', members, itemCount: 1 });
  }

  const squads = [...bySignature.values()].sort(
    (a, b) => b.members.length - a.members.length || b.itemCount - a.itemCount,
  );
  for (const squad of squads) {
    squad.name =
      squad.members.length === people.length
        ? `Everyone (${squad.members.length})`
        : `Group of ${squad.members.length}`;
  }
  // Disambiguate same-sized groups so two squads never share a name.
  const seen = new Map<string, number>();
  for (const squad of squads) {
    const count = (seen.get(squad.name) ?? 0) + 1;
    seen.set(squad.name, count);
    if (count > 1) squad.name = `${squad.name} #${count}`;
  }

  return {
    currency,
    people,
    items,
    emptyColumns,
    grandTotalMinor: items.reduce((sum, item) => sum + item.totalMinor, 0),
    computedTotals,
    declaredTotals,
    discrepancies,
    squads,
  };
}

/** Convenience: text straight to a plan. */
export function planFromText(text: string, options: ImportOptions): ImportPlan {
  return buildImportPlan(detectMatrix(parseDelimited(text)), options);
}

/** Every item must have a payer before a plan can be applied. */
export function missingPayers(plan: ImportPlan): ImportItem[] {
  return plan.items.filter((item) => !item.payerName);
}
