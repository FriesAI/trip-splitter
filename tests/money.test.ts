import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  assertMinor,
  convert,
  decimalsFor,
  formatAmount,
  parseAmount,
  roundHalfUp,
  sumMinor,
} from '../src/money.js';

describe('currency metadata', () => {
  it('knows the zero-decimal currencies', () => {
    expect(decimalsFor('ISK')).toBe(0);
    expect(decimalsFor('JPY')).toBe(0);
    expect(decimalsFor('KRW')).toBe(0);
  });

  it('knows the two-decimal currencies of this trip', () => {
    expect(decimalsFor('MYR')).toBe(2);
    expect(decimalsFor('GBP')).toBe(2);
    expect(decimalsFor('EUR')).toBe(2);
  });

  it('is case-insensitive and assumes two decimals for anything unlisted', () => {
    expect(decimalsFor('isk')).toBe(0);
    expect(decimalsFor('XYZ')).toBe(2);
  });
});

describe('assertMinor', () => {
  it('rejects a fractional value, which means major units leaked in', () => {
    expect(() => assertMinor(1033.64)).toThrow(MoneyError);
    expect(() => assertMinor(1033.64)).toThrow(/whole number of minor units/);
  });

  it('rejects NaN', () => {
    expect(() => assertMinor(Number.NaN)).toThrow(MoneyError);
  });

  it('accepts negatives, for refunds', () => {
    expect(assertMinor(-500)).toBe(-500);
  });
});

describe('roundHalfUp', () => {
  it('rounds away from zero at the halfway point in both directions', () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(-0.5)).toBe(-1);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });
});

describe('parseAmount', () => {
  it('parses ordinary MYR', () => {
    expect(parseAmount('1033.64', 'MYR')).toBe(103_364);
    expect(parseAmount('142.30', 'MYR')).toBe(14_230);
    expect(parseAmount('0.01', 'MYR')).toBe(1);
  });

  it('pads a short fraction rather than misreading it', () => {
    expect(parseAmount('142.3', 'MYR')).toBe(14_230);
    expect(parseAmount('142', 'MYR')).toBe(14_200);
  });

  it('treats ISK as whole krona', () => {
    expect(parseAmount('14900', 'ISK')).toBe(14_900);
    expect(parseAmount('14,900', 'ISK')).toBe(14_900);
  });

  it('refuses decimals on a zero-decimal currency instead of silently rounding', () => {
    expect(() => parseAmount('14900.50', 'ISK')).toThrow(/no decimal places/);
  });

  it('refuses more precision than the currency has', () => {
    expect(() => parseAmount('1.234', 'MYR')).toThrow(/2 decimal places/);
  });

  it('handles separators, whitespace and signs', () => {
    expect(parseAmount('  1,033.64 ', 'MYR')).toBe(103_364);
    expect(parseAmount('-25.00', 'MYR')).toBe(-2_500);
    expect(parseAmount('+25', 'MYR')).toBe(2_500);
  });

  it('rejects junk', () => {
    for (const bad of ['', '  ', 'abc', '1.2.3', '.', '-']) {
      expect(() => parseAmount(bad, 'MYR')).toThrow(MoneyError);
    }
  });

  it('round-trips through formatAmount', () => {
    for (const text of ['0.00', '0.01', '12.34', '1033.64', '116823.04']) {
      expect(formatAmount(parseAmount(text, 'MYR'), 'MYR', { grouping: false })).toBe(text);
    }
  });
});

describe('formatAmount', () => {
  it('groups thousands and keeps the minor digits', () => {
    expect(formatAmount(103_364, 'MYR')).toBe('1,033.64');
    expect(formatAmount(11_682_304, 'MYR')).toBe('116,823.04');
    expect(formatAmount(1, 'MYR')).toBe('0.01');
    expect(formatAmount(0, 'MYR')).toBe('0.00');
  });

  it('prints ISK with no decimal point at all', () => {
    expect(formatAmount(14_900, 'ISK')).toBe('14,900');
    expect(formatAmount(0, 'ISK')).toBe('0');
  });

  it('keeps the sign outside the digits', () => {
    expect(formatAmount(-103_364, 'MYR')).toBe('-1,033.64');
  });

  it('refuses to format a float', () => {
    expect(() => formatAmount(10.5, 'MYR')).toThrow(MoneyError);
  });
});

describe('convert', () => {
  it('crosses a decimal-place boundary: ISK has none, MYR has two', () => {
    // ISK 14,900 at 0.0321 MYR per krona is RM 478.29.
    expect(convert(14_900, 0.0321, 'ISK', 'MYR')).toBe(47_829);
  });

  it('converts between two-decimal currencies', () => {
    // GBP 45.00 at 5.62 MYR per pound is RM 252.90.
    expect(convert(4_500, 5.62, 'GBP', 'MYR')).toBe(25_290);
  });

  it('converts back down to a zero-decimal currency', () => {
    expect(convert(47_829, 1 / 0.0321, 'MYR', 'ISK')).toBe(14_900);
  });

  it('is a no-op when the currencies match, whatever the rate', () => {
    expect(convert(103_364, 1, 'MYR', 'MYR')).toBe(103_364);
    expect(convert(103_364, 99, 'myr', 'MYR')).toBe(103_364);
  });

  it('always returns an integer', () => {
    for (const rate of [0.0321, 5.62, 1.0003, 0.000001, 12345.6789]) {
      const result = convert(9_999, rate, 'GBP', 'MYR');
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  it('rejects a rate that is not a positive finite number', () => {
    for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => convert(100, rate, 'GBP', 'MYR')).toThrow(MoneyError);
    }
  });
});

describe('sumMinor', () => {
  it('adds integers and rejects anything else', () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(sumMinor([])).toBe(0);
    expect(() => sumMinor([1, 2.5])).toThrow(MoneyError);
  });
});
