import { describe, expect, it } from 'vitest';
import { D } from '../money/index.js';
import { fmtAmount, fmtNumber, fmtRate } from './format.js';

describe('German number formatting for messages', () => {
  it('fmtAmount: 2 decimal places, comma, thousands dot', () => {
    expect(fmtAmount(D('1234.5'))).toBe('1.234,50');
    expect(fmtAmount(D('234.56'))).toBe('234,56');
    expect(fmtAmount(D('0'))).toBe('0,00');
    expect(fmtAmount(D('-1234567.891'))).toBe('-1.234.567,89');
    expect(fmtAmount(D('999'))).toBe('999,00');
    expect(fmtAmount(D('1000'))).toBe('1.000,00');
  });

  it('fmtRate: percentage without trailing zeros, with a comma', () => {
    expect(fmtRate(D('19'))).toBe('19 %');
    expect(fmtRate(D('5.5'))).toBe('5,5 %');
    expect(fmtRate(D('0'))).toBe('0 %');
    expect(fmtRate(D('19.00'))).toBe('19 %');
  });

  it('fmtNumber: any number of decimal places, with a comma', () => {
    expect(fmtNumber(D('12.3456'))).toBe('12,3456');
    expect(fmtNumber(D('3'))).toBe('3');
    expect(fmtNumber(D('-0.5'))).toBe('-0,5');
    expect(fmtNumber(D('12345.678'))).toBe('12.345,678');
  });
});
