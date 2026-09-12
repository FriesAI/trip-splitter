/**
 * Money. Integer minor units, everywhere, at every layer.
 *
 * A "minor unit" is the smallest indivisible piece of a currency: a sen for
 * MYR, a penny for GBP, a cent for EUR. Some currencies have none — the
 * Icelandic króna's aurar was abolished in 2003, so ISK's minor unit *is* the
 * króna. Getting that wrong scales every Icelandic amount by 100, which is why
 * `decimalsFor` is consulted rather than assumed.
 *
 * Floats never hold money here. They appear in exactly one place — an FX rate
 * inside `convert` — and the result is rounded to an integer immediately and
 * frozen by the caller, so the error cannot compound.
 */

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

/** Minor-unit exponent per currency. Anything unlisted is assumed to have 2. */
const DECIMALS: Readonly<Record<string, number>> = {
  MYR: 2,
  GBP: 2,
  EUR: 2,
  USD: 2,
  SGD: 2,
  AUD: 2,
  CHF: 2,
  THB: 2,
  // Zero-decimal currencies. These are the trap.
  ISK: 0,
  JPY: 0,
  KRW: 0,
  VND: 0,
};

export const DEFAULT_DECIMALS = 2;

export function decimalsFor(currency: string): number {
  return DECIMALS[currency.toUpperCase()] ?? DEFAULT_DECIMALS;
}

/** Guard every boundary: a non-integer here means a float leaked in upstream. */
export function assertMinor(value: number, label = 'amount'): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new MoneyError(`${label} must be a number, got ${String(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(
      `${label} must be a whole number of minor units, got ${value} — ` +
        `a fractional value means major units or a float leaked in`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} exceeds the safe integer range: ${value}`);
  }
  return value;
}

/** Round half away from zero, so -0.5 becomes -1 rather than 0. */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Parse a human-typed amount into minor units.
 *
 * Accepts thousands separators and surrounding whitespace. Rejects more
 * decimal places than the currency has, rather than silently truncating —
 * "14900.50" in ISK is a mistake worth surfacing, not rounding away.
 */
export function parseAmount(input: string, currency: string): number {
  const decimals = decimalsFor(currency);
  const cleaned = input.trim().replace(/[\s,_]/g, '');
  if (cleaned === '' || !/^[+-]?\d*(\.\d*)?$/.test(cleaned) || !/\d/.test(cleaned)) {
    throw new MoneyError(`"${input}" is not a valid amount`);
  }

  const negative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/^[+-]/, '');
  const [whole = '', fraction = ''] = unsigned.split('.');

  if (fraction.length > decimals) {
    throw new MoneyError(
      decimals === 0
        ? `${currency} has no decimal places, but "${input}" has ${fraction.length}`
        : `${currency} has ${decimals} decimal places, but "${input}" has ${fraction.length}`,
    );
  }

  const digits = `${whole || '0'}${fraction.padEnd(decimals, '0')}`;
  const magnitude = Number(digits);
  if (!Number.isSafeInteger(magnitude)) {
    throw new MoneyError(`"${input}" is too large to represent exactly`);
  }
  return negative ? -magnitude : magnitude;
}

/** Format minor units for display: 103364 MYR -> "1,033.64"; 14900 ISK -> "14,900". */
export function formatAmount(
  amountMinor: number,
  currency: string,
  options: { grouping?: boolean } = {},
): string {
  assertMinor(amountMinor);
  const { grouping = true } = options;
  const decimals = decimalsFor(currency);
  const negative = amountMinor < 0;
  const digits = String(Math.abs(amountMinor)).padStart(decimals + 1, '0');

  const whole = decimals === 0 ? digits : digits.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : digits.slice(-decimals);
  const grouped = grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;

  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Convert between currencies at a given rate, returning minor units of `to`.
 *
 * `rate` is expressed in major units — the number you would read off a rate
 * table or a Google search: 0.0321 MYR per ISK. The decimal-place difference
 * between the two currencies is applied here, so ISK (0dp) to MYR (2dp)
 * works without the caller thinking about it.
 *
 * The result is rounded once. Callers freeze it on the expense and never
 * recompute, so a later rate change cannot move a settled balance.
 */
export function convert(
  amountMinor: number,
  rate: number,
  from: string,
  to: string,
): number {
  assertMinor(amountMinor);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new MoneyError(`exchange rate must be a positive finite number, got ${rate}`);
  }
  if (from.toUpperCase() === to.toUpperCase()) return amountMinor;

  const shift = decimalsFor(to) - decimalsFor(from);
  return roundHalfUp(amountMinor * rate * 10 ** shift);
}

export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += assertMinor(value);
  return total;
}
