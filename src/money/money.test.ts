import { describe, expect, it } from 'vitest';
import {
  D,
  add,
  fromInput,
  isDecimal,
  mul,
  round2,
  roundHalfAwayFromZero,
  sub,
  sum,
  toFixed2,
  ZERO,
} from './money.js';

describe('roundHalfAwayFromZero', () => {
  it('rounds commercially (half away from zero), not bankers rounding', () => {
    expect(roundHalfAwayFromZero(D('2.345'), 2).toString()).toBe('2.35');
    expect(roundHalfAwayFromZero(D('-2.345'), 2).toString()).toBe('-2.35');
    expect(roundHalfAwayFromZero(D('2.344999'), 2).toString()).toBe('2.34');
    expect(roundHalfAwayFromZero(D('2.5'), 0).toString()).toBe('3');
    expect(roundHalfAwayFromZero(D('-2.5'), 0).toString()).toBe('-3'); // Banker's rounding would give -2
    expect(roundHalfAwayFromZero(D('0.125'), 2).toString()).toBe('0.13'); // Banker's rounding would give 0.12
    expect(roundHalfAwayFromZero(D('-0.125'), 2).toString()).toBe('-0.13'); // plain half-up (toward +infinity) would give -0.12
  });

  it('is exact, not float-based (1.005 → 1.01)', () => {
    // With a float, 1.005 would internally be 1.00499999... and would round to 1.00.
    expect(roundHalfAwayFromZero(D('1.005'), 2).toString()).toBe('1.01');
  });
});

describe('round2 / toFixed2', () => {
  it('round2 returns a Decimal with at most 2 decimal places', () => {
    expect(round2(D('234.555')).toString()).toBe('234.56');
    expect(round2(D('10')).decimalPlaces()).toBe(0);
  });

  it('toFixed2 always returns exactly two decimal places with a dot', () => {
    expect(toFixed2(D('10'))).toBe('10.00');
    expect(toFixed2(D('0.1'))).toBe('0.10');
    expect(toFixed2(D('-3'))).toBe('-3.00');
    expect(toFixed2(D('1234.5'))).toBe('1234.50');
  });

  it('toFixed2 rounds half away from zero when more digits are present', () => {
    expect(toFixed2(D('2.345'))).toBe('2.35');
    expect(toFixed2(D('-2.345'))).toBe('-2.35');
  });
});

describe('Arithmetik', () => {
  it('add/sub/mul work exactly', () => {
    expect(add(D('0.1'), D('0.2')).toString()).toBe('0.3');
    expect(sub(D('1'), D('0.9')).toString()).toBe('0.1');
    expect(mul(D('1234.5'), D('0.19')).toString()).toBe('234.555');
  });

  it('sum adds up a list, an empty list yields 0', () => {
    expect(sum([D('1.1'), D('2.2'), D('3.3')]).toString()).toBe('6.6');
    expect(sum([]).eq(ZERO)).toBe(true);
  });

  it('the worked example: 1234.50 × 19 % = 234.56', () => {
    expect(toFixed2(mul(D('1234.50'), D('19')).div(100))).toBe('234.56');
  });
});

describe('fromInput', () => {
  it('accepts number and string with a dot', () => {
    expect(fromInput(12.5).toString()).toBe('12.5');
    expect(fromInput('12.5').toString()).toBe('12.5');
    expect(fromInput('-0.0001').toString()).toBe('-0.0001');
    expect(fromInput(0).toString()).toBe('0');
    expect(fromInput('1e3').toString()).toBe('1000');
  });

  it('rejects a comma as the decimal separator (no guessing)', () => {
    expect(() => fromInput('12,5')).toThrow(/comma/);
    expect(() => fromInput('1.234,50')).toThrow(/comma/);
  });

  it('rejects empty and non-numeric strings', () => {
    expect(() => fromInput('')).toThrow();
    expect(() => fromInput('abc')).toThrow();
    expect(() => fromInput('12.5 EUR')).toThrow();
  });

  it('rejects NaN and Infinity', () => {
    expect(() => fromInput(Number.NaN)).toThrow();
    expect(() => fromInput(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => fromInput('Infinity')).toThrow();
    expect(() => fromInput('NaN')).toThrow();
  });
});

describe('isDecimal', () => {
  it('recognizes Decimal instances', () => {
    expect(isDecimal(D(1))).toBe(true);
    expect(isDecimal(1)).toBe(false);
    expect(isDecimal('1')).toBe(false);
  });
});
