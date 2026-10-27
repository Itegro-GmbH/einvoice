import { describe, expect, it } from 'vitest';
import { D } from '../money/index.js';
import { fmtDate, fmtMoney, fmtQuantity, fmtPercent, unitName, fill } from './format.js';
import { de } from './i18n/de.js';

describe('render/format (de)', () => {
  it('amounts: thousands dot, comma, 2 decimals, currency symbol', () => {
    expect(fmtMoney(D('1234.5'), 'EUR')).toBe('1.234,50 €');
    expect(fmtMoney(D('-43.5'), 'EUR')).toBe('-43,50 €');
    expect(fmtMoney(D('0'), 'EUR')).toBe('0,00 €');
    expect(fmtMoney(D('1000000'), 'EUR')).toBe('1.000.000,00 €');
    expect(fmtMoney(D('12.3'), 'USD')).toBe('12,30 USD');
    expect(fmtMoney(D('12.3'), 'CHF')).toBe('12,30 CHF');
  });

  it('quantities without unnecessary zeros, with thousands dot', () => {
    expect(fmtQuantity(D('12'))).toBe('12');
    expect(fmtQuantity(D('2.50'))).toBe('2,5');
    expect(fmtQuantity(D('1500'))).toBe('1.500');
    expect(fmtQuantity(D('0.001'))).toBe('0,001');
    expect(fmtQuantity(D('-3'))).toBe('-3');
  });

  it('percentages', () => {
    expect(fmtPercent(D('19'))).toBe('19 %');
    expect(fmtPercent(D('5.5'))).toBe('5,5 %');
    expect(fmtPercent(D('0'))).toBe('0 %');
  });

  it('date ISO → German', () => {
    expect(fmtDate('2026-09-12')).toBe('12.09.2026');
    expect(fmtDate('2026-01-05')).toBe('05.01.2026');
  });

  it('unit code → readable name, unknown code is kept', () => {
    expect(unitName('C62', de)).toBe('Stk.');
    expect(unitName('HUR', de)).toBe('Std.');
    expect(unitName('LS', de)).toBe('pauschal');
    expect(unitName('MON', de)).toBe('Monat');
    expect(unitName('XYZ', de)).toBe('XYZ');
  });

  it('fill replaces placeholders', () => {
    expect(fill('Seite {n} von {m}', { n: 2, m: 5 })).toBe('Seite 2 von 5');
  });
});
