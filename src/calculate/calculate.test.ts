import { describe, expect, it } from 'vitest';
import type { InvoiceInput, LineInput } from '../model/input.js';
import { normalize } from '../normalize/index.js';
import { calculate, type CalculatedInvoice } from './calculate.js';

const party = (name: string) => ({ name, address: { street: 'S', city: 'C', postalCode: '1', country: 'DE' } });

function build(lines: LineInput[], extra: Partial<InvoiceInput> = {}): CalculatedInvoice {
  return calculate(normalize({ number: 'R1', issueDate: '2026-09-12', seller: party('A'), buyer: party('B'), lines, ...extra }));
}

const s19 = { category: 'S', rate: 19 } as const;
const s7 = { category: 'S', rate: 7 } as const;

function str(inv: CalculatedInvoice): Record<string, string> {
  const t = inv.totals;
  return {
    lineTotal: t.lineTotal.toFixed(2),
    allowanceTotal: t.allowanceTotal.toFixed(2),
    chargeTotal: t.chargeTotal.toFixed(2),
    taxExclusive: t.taxExclusiveAmount.toFixed(2),
    taxTotal: t.taxTotal.toFixed(2),
    taxInclusive: t.taxInclusiveAmount.toFixed(2),
    prepaid: t.prepaidAmount.toFixed(2),
    rounding: t.roundingAmount.toFixed(2),
    payable: t.payableAmount.toFixed(2),
  };
}

describe('calculate – worked example (1234,50 × 19 % = 234,56)', () => {
  it('computes the tax on the total taxable amount, not per line', () => {
    // 3 × 411,50 = 1234,50. Per line: 411,50 × 19 % = 78,185 → 78,19; × 3 = 234,57 (wrong).
    const inv = build([
      { name: 'A', quantity: 1, unit: 'C62', unitPrice: '411.50', vat: s19 },
      { name: 'B', quantity: 1, unit: 'C62', unitPrice: '411.50', vat: s19 },
      { name: 'C', quantity: 1, unit: 'C62', unitPrice: '411.50', vat: s19 },
    ]);
    expect(inv.totals.lineTotal.toFixed(2)).toBe('1234.50');
    expect(inv.vatBreakdown).toHaveLength(1);
    expect(inv.vatBreakdown[0]!.taxableAmount.toFixed(2)).toBe('1234.50');
    expect(inv.vatBreakdown[0]!.taxAmount.toFixed(2)).toBe('234.56');
    // Cross-check: adding up per line would give 234.57
    const perLine = inv.lines.reduce((acc, l) => acc + Math.round(l.netAmount.toNumber() * 0.19 * 100) / 100, 0);
    expect(perLine.toFixed(2)).toBe('234.57');
    expect(str(inv)).toEqual({
      lineTotal: '1234.50',
      allowanceTotal: '0.00',
      chargeTotal: '0.00',
      taxExclusive: '1234.50',
      taxTotal: '234.56',
      taxInclusive: '1469.06',
      prepaid: '0.00',
      rounding: '0.00',
      payable: '1469.06',
    });
  });
});

describe('calculate – lines', () => {
  it('BT-131 = round2(qty × price / base), unit price with 4 decimal places', () => {
    const inv = build([
      { name: 'A', quantity: 3, unit: 'C62', unitPrice: '0.3333', vat: s19 },
      { name: 'B', quantity: '1.5', unit: 'C62', unitPrice: '2.345', vat: s19 },
    ]);
    expect(inv.lines[0]!.netAmount.toFixed(2)).toBe('1.00'); // 0.9999
    expect(inv.lines[1]!.netAmount.toFixed(2)).toBe('3.52'); // 3.5175
    expect(inv.lines[0]!.unitPrice.toString()).toBe('0.3333');
  });

  it('priceBaseQuantity ≠ 1: 250 pieces at 12,50 per 100', () => {
    const inv = build([{ name: 'A', quantity: 250, unit: 'C62', unitPrice: '12.50', priceBaseQuantity: 100, vat: s19 }]);
    expect(inv.lines[0]!.netAmount.toFixed(2)).toBe('31.25');
  });

  it('line allowance as an amount and charge as a percentage (Basis = qty × price / base)', () => {
    const inv = build([
      { name: 'A', quantity: 10, unit: 'C62', unitPrice: 5, vat: s19, allowances: [{ amount: 5, reason: 'Treue' }], charges: [{ percent: 10 }] },
    ]);
    const l = inv.lines[0]!;
    expect(l.grossAmount.toString()).toBe('50');
    expect(l.allowances[0]!.amount.toFixed(2)).toBe('5.00');
    expect(l.charges[0]!.amount.toFixed(2)).toBe('5.00'); // 10 % of 50
    expect(l.netAmount.toFixed(2)).toBe('50.00'); // 50 − 5 + 5
  });

  it('a percentage line allowance is applied to the unrounded line gross value', () => {
    const inv = build([{ name: 'A', quantity: 3, unit: 'C62', unitPrice: '0.3333', vat: s19, allowances: [{ percent: 10 }] }]);
    const l = inv.lines[0]!;
    expect(l.allowances[0]!.amount.toFixed(2)).toBe('0.10'); // 0.09999 → 0.10
    expect(l.netAmount.toFixed(2)).toBe('0.90'); // round2(0.9999 − 0.10)
  });
});

describe('calculate – categories and rates', () => {
  it('multiple rates 7 % / 19 % → separate breakdowns, deterministically sorted', () => {
    const inv = build([
      { name: 'Buch', quantity: 1, unit: 'C62', unitPrice: 100, vat: s7 },
      { name: 'Beratung', quantity: 1, unit: 'HUR', unitPrice: 100, vat: s19 },
      { name: 'Buch 2', quantity: 2, unit: 'C62', unitPrice: '0.50', vat: s7 },
    ]);
    expect(inv.vatBreakdown.map((b) => [b.category, b.rate.toString(), b.taxableAmount.toFixed(2), b.taxAmount.toFixed(2)])).toEqual([
      ['S', '7', '101.00', '7.07'],
      ['S', '19', '100.00', '19.00'],
    ]);
    expect(inv.totals.taxTotal.toFixed(2)).toBe('26.07');
    expect(inv.totals.taxInclusiveAmount.toFixed(2)).toBe('227.07');
  });

  it('Reverse Charge (AE): tax 0, full taxable amount', () => {
    const inv = build([{ name: 'A', quantity: 2, unit: 'HUR', unitPrice: '150.00', vat: { category: 'AE' } }]);
    expect(inv.vatBreakdown).toEqual([
      expect.objectContaining({ category: 'AE' }),
    ]);
    expect(inv.vatBreakdown[0]!.rate.toString()).toBe('0');
    expect(inv.vatBreakdown[0]!.taxableAmount.toFixed(2)).toBe('300.00');
    expect(inv.vatBreakdown[0]!.taxAmount.toFixed(2)).toBe('0.00');
    expect(inv.totals.taxTotal.toFixed(2)).toBe('0.00');
    expect(inv.totals.payableAmount.toFixed(2)).toBe('300.00');
  });

  it('categories are emitted in a fixed order (S, Z, E, AE, K, G, O, L, M), then by rate', () => {
    const inv = build([
      { name: 'k', quantity: 1, unit: 'C62', unitPrice: 1, vat: { category: 'K' } },
      { name: 's', quantity: 1, unit: 'C62', unitPrice: 1, vat: s19 },
      { name: 'e', quantity: 1, unit: 'C62', unitPrice: 1, vat: { category: 'E', rate: 0 } },
      { name: 'z', quantity: 1, unit: 'C62', unitPrice: 1, vat: { category: 'Z' } },
      { name: 's7', quantity: 1, unit: 'C62', unitPrice: 1, vat: s7 },
    ]);
    expect(inv.vatBreakdown.map((b) => `${b.category}|${b.rate.toString()}`)).toEqual(['S|7', 'S|19', 'Z|0', 'E|0', 'K|0']);
  });
});

describe('calculate – credit note / negative quantities', () => {
  it('negative quantities yield negative lines, tax and totals (commercially rounded)', () => {
    const inv = build([{ name: 'Storno', quantity: -3, unit: 'C62', unitPrice: '411.50', vat: s19 }], { type: 'credit-note' });
    expect(inv.typeCode).toBe('381');
    expect(inv.lines[0]!.netAmount.toFixed(2)).toBe('-1234.50');
    expect(inv.vatBreakdown[0]!.taxAmount.toFixed(2)).toBe('-234.56'); // -234.555 → -234.56 (half away from zero)
    expect(inv.totals.payableAmount.toFixed(2)).toBe('-1469.06');
  });
});

describe('calculate – document allowances/charges', () => {
  it('amount and percentage per category: base for the percentage = sum of the lines of this (category, rate)', () => {
    const inv = build(
      [
        { name: 'A', quantity: 1, unit: 'C62', unitPrice: 100, vat: s19 },
        { name: 'B', quantity: 1, unit: 'C62', unitPrice: 200, vat: s7 },
      ],
      {
        allowances: [{ percent: 10, vat: s19, reason: 'Rabatt' }], // 10 % of 100 = 10
        charges: [{ amount: '4.90', vat: s19, reason: 'Versand' }],
      },
    );
    expect(inv.allowances[0]!.amount.toFixed(2)).toBe('10.00');
    expect(inv.charges[0]!.amount.toFixed(2)).toBe('4.90');
    const s19b = inv.vatBreakdown.find((b) => b.rate.eq(19))!;
    const s7b = inv.vatBreakdown.find((b) => b.rate.eq(7))!;
    expect(s19b.taxableAmount.toFixed(2)).toBe('94.90'); // 100 − 10 + 4.90
    expect(s19b.taxAmount.toFixed(2)).toBe('18.03'); // 18.031
    expect(s7b.taxableAmount.toFixed(2)).toBe('200.00');
    expect(s7b.taxAmount.toFixed(2)).toBe('14.00');
    expect(str(inv)).toMatchObject({
      lineTotal: '300.00',
      allowanceTotal: '10.00',
      chargeTotal: '4.90',
      taxExclusive: '294.90',
      taxTotal: '32.03',
      taxInclusive: '326.93',
      payable: '326.93',
    });
  });

  it('a document allowance for a category without lines creates its own (negative) breakdown', () => {
    const inv = build([{ name: 'A', quantity: 1, unit: 'C62', unitPrice: 100, vat: s19 }], {
      allowances: [{ amount: 5, vat: s7 }],
    });
    expect(inv.vatBreakdown.map((b) => [b.rate.toString(), b.taxableAmount.toFixed(2), b.taxAmount.toFixed(2)])).toEqual([
      ['7', '-5.00', '-0.35'],
      ['19', '100.00', '19.00'],
    ]);
    expect(inv.totals.taxExclusiveAmount.toFixed(2)).toBe('95.00');
  });
});

describe('calculate – prepayment and rounding', () => {
  it('BT-115 = BT-112 − BT-113 + BT-114', () => {
    const inv = build([{ name: 'A', quantity: 1, unit: 'C62', unitPrice: 100, vat: s19 }], {
      prepaidAmount: '19.00',
      roundingAmount: '-0.01',
    });
    expect(str(inv)).toMatchObject({ taxInclusive: '119.00', prepaid: '19.00', rounding: '-0.01', payable: '99.99' });
  });
});

describe('calculate – invariants', () => {
  it('all output amounts have at most 2 decimal places', () => {
    const inv = build([
      { name: 'A', quantity: '1.2345', unit: 'C62', unitPrice: '9.8765', vat: s19, allowances: [{ percent: '3.3' }] },
      { name: 'B', quantity: 7, unit: 'C62', unitPrice: '0.0001', vat: s7 },
    ]);
    for (const l of inv.lines) {
      expect(l.netAmount.decimalPlaces()).toBeLessThanOrEqual(2);
      for (const ac of [...l.allowances, ...l.charges]) expect(ac.amount.decimalPlaces()).toBeLessThanOrEqual(2);
    }
    for (const b of inv.vatBreakdown) {
      expect(b.taxableAmount.decimalPlaces()).toBeLessThanOrEqual(2);
      expect(b.taxAmount.decimalPlaces()).toBeLessThanOrEqual(2);
    }
    for (const v of Object.values(inv.totals)) expect(v.decimalPlaces()).toBeLessThanOrEqual(2);
  });

  it('is pure and deterministic', () => {
    const n = normalize({
      number: 'R1',
      issueDate: '2026-09-12',
      seller: party('A'),
      buyer: party('B'),
      lines: [{ name: 'A', quantity: 3, unit: 'C62', unitPrice: '411.50', vat: s19 }],
    });
    const snapshot = JSON.stringify(n);
    const a = calculate(n);
    const b = calculate(n);
    expect(JSON.stringify(n)).toBe(snapshot);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('keeps the normalized header data', () => {
    const inv = build([{ name: 'A', quantity: 1, unit: 'C62', unitPrice: 1, vat: s19 }], { buyerReference: 'LW-1' });
    expect(inv.number).toBe('R1');
    expect(inv.buyerReference).toBe('LW-1');
    expect(inv.seller.name).toBe('A');
  });
});
