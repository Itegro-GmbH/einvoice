import { describe, expect, it } from 'vitest';
import { calculate } from '../calculate/index.js';
import { InvoiceError } from '../errors/index.js';
import type { CalculatedInvoice } from '../model/calculated.js';
import type { InvoiceInput } from '../model/input.js';
import { normalize } from '../normalize/index.js';
import { assertValid, validate, type ValidationResult } from './validate.js';

/** A fully valid domestic invoice, producing neither violations nor warnings. */
const base: InvoiceInput = {
  number: 'RE-2026-00042',
  issueDate: '2026-09-12',
  dueDate: '2026-09-26',
  deliveryDate: '2026-09-10',
  seller: {
    name: 'Musterwerk GmbH',
    address: { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' },
    vatId: 'DE123456789',
    contact: { name: 'Erika Muster', email: 'rechnung@musterwerk.example', phone: '+49 711 123456' },
    electronicAddress: { scheme: 'EM', value: 'rechnung@musterwerk.example' },
  },
  buyer: {
    name: 'Beispiel & Söhne KG',
    address: { street: 'Hauptstraße 1', city: 'Berlin', postalCode: '10115', country: 'DE' },
    electronicAddress: { scheme: 'EM', value: 'einkauf@beispiel.example' },
  },
  payment: { means: 'transfer', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
  lines: [
    { name: 'Beratung', quantity: 12, unit: 'Stunde', unitPrice: '95.00', vat: { category: 'S', rate: 19 } },
    { name: 'Fachbuch', quantity: 2, unit: 'Stück', unitPrice: '29.90', vat: { category: 'S', rate: 7 } },
  ],
};

function run(input: InvoiceInput): ValidationResult {
  return validate(calculate(normalize(input)));
}

function rules(result: ValidationResult): string[] {
  return result.violations.map((v) => v.rule);
}

function only(result: ValidationResult, rule: string) {
  const hits = result.violations.filter((v) => v.rule === rule);
  expect(hits, `expected exactly one violation ${rule}, got: ${JSON.stringify(result.violations)}`).toHaveLength(1);
  return hits[0]!;
}

function warning(result: ValidationResult, code: string) {
  const hits = result.warnings.filter((w) => w.code === code);
  expect(hits, `expected exactly one warning ${code}, got: ${JSON.stringify(result.warnings)}`).toHaveLength(1);
  return hits[0]!;
}

const line = base.lines[0]!;
const withLines = (...lines: InvoiceInput['lines']): InvoiceInput => ({ ...base, lines });
const withVat = (vat: InvoiceInput['lines'][number]['vat']): InvoiceInput => withLines({ ...line, vat });

describe('validate - basic behavior', () => {
  it('valid invoice: no violations, no warnings', () => {
    const r = run(base);
    expect(r.violations).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('never throws; assertValid throws InvoiceError with the same violations', () => {
    const bad = withLines({ ...line, unitPrice: -1 });
    const r = run(bad);
    expect(r.violations.length).toBeGreaterThan(0);
    expect(() => assertValid(calculate(normalize(bad)))).toThrow(InvoiceError);
    try {
      assertValid(calculate(normalize(bad)));
    } catch (e) {
      expect((e as InvoiceError).violations).toEqual(r.violations);
    }
    expect(() => assertValid(calculate(normalize(base)))).not.toThrow();
  });

  it('is pure: the CalculatedInvoice remains unchanged', () => {
    const c = calculate(normalize(base));
    const before = JSON.stringify(c);
    validate(c);
    expect(JSON.stringify(c)).toBe(before);
  });
});

describe('Document rules BR-01...BR-11, BR-16 (on the model; Zod normally catches these earlier)', () => {
  function tamper(mut: (c: CalculatedInvoice) => void): ValidationResult {
    const c = calculate(normalize(base)); // fresh object per call, may be mutated
    mut(c);
    return validate(c);
  }

  it.each([
    ['BR-01', 'profile', 'BT-24', (c: CalculatedInvoice) => void (c.profileUrn = '')],
    ['BR-02', 'number', 'BT-1', (c: CalculatedInvoice) => void (c.number = '  ')],
    ['BR-03', 'issueDate', 'BT-2', (c: CalculatedInvoice) => void (c.issueDate = '')],
    ['BR-04', 'type', 'BT-3', (c: CalculatedInvoice) => void ((c as { typeCode: string }).typeCode = '')],
    ['BR-05', 'currency', 'BT-5', (c: CalculatedInvoice) => void (c.currency = '')],
    ['BR-06', 'seller.name', 'BT-27', (c: CalculatedInvoice) => void (c.seller.name = '')],
    ['BR-07', 'buyer.name', 'BT-44', (c: CalculatedInvoice) => void (c.buyer.name = '')],
    ['BR-09', 'seller.address.country', 'BT-40', (c: CalculatedInvoice) => void (c.seller.address.country = '')],
    ['BR-11', 'buyer.address.country', 'BT-55', (c: CalculatedInvoice) => void (c.buyer.address.country = '')],
    ['BR-16', 'lines', 'BG-25', (c: CalculatedInvoice) => void (c.lines = [])],
  ])('%s → path %s, %s', (rule, path, bt, mut) => {
    const r = tamper(mut);
    expect(only(r, rule)).toMatchObject({ path, businessTerm: bt });
  });
});

describe('Lines and allowances/charges', () => {
  it('BR-27: negative unit price', () => {
    const r = run(withLines({ ...line, unitPrice: '-5.00' }));
    const v = only(r, 'BR-27');
    expect(v).toMatchObject({ path: 'lines[0].unitPrice', businessTerm: 'BT-146' });
    expect(v.message).toContain('-5,00');
    expect(v.hint).toContain('quantity');
  });

  it('BR-33/BR-38: document level allowance/charge needs reason or reasonCode', () => {
    const r = run({
      ...base,
      allowances: [{ amount: 5, vat: { category: 'S', rate: 19 } }, { amount: 1, reason: 'Treue', vat: { category: 'S', rate: 19 } }],
      charges: [{ amount: 3, vat: { category: 'S', rate: 19 } }, { amount: 1, reasonCode: 'FC', vat: { category: 'S', rate: 19 } }],
    });
    expect(only(r, 'BR-33')).toMatchObject({ path: 'allowances[0].reason', businessTerm: 'BT-97' });
    expect(only(r, 'BR-38')).toMatchObject({ path: 'charges[0].reason', businessTerm: 'BT-104' });
    expect(only(r, 'BR-33').message).toContain('5,00');
  });

  it('BR-42/BR-44: line allowance/charge needs reason or reasonCode', () => {
    const r = run(withLines({ ...line, allowances: [{ percent: 10 }], charges: [{ amount: 2 }, { amount: 1, reason: 'Fracht' }] }));
    expect(only(r, 'BR-42')).toMatchObject({ path: 'lines[0].allowances[0].reason', businessTerm: 'BT-139' });
    expect(only(r, 'BR-44')).toMatchObject({ path: 'lines[0].charges[0].reason', businessTerm: 'BT-144' });
  });

  it('BR-DEC: input amounts with more than 2 decimal places are rejected instead of rounded silently', () => {
    const r = run({
      ...base,
      prepaidAmount: '10.005',
      roundingAmount: 0.001,
      allowances: [{ amount: '1.234', reason: 'x', vat: { category: 'S', rate: 19 } }],
      charges: [{ amount: '2.345', reason: 'x', vat: { category: 'S', rate: 19 } }],
      lines: [{ ...line, allowances: [{ amount: '0.123', reason: 'x' }], charges: [{ amount: '0.456', reason: 'x' }] }],
    });
    expect(only(r, 'BR-DEC-16')).toMatchObject({ path: 'prepaidAmount', businessTerm: 'BT-113' });
    expect(only(r, 'BR-DEC-16').message).toContain('10,005');
    expect(only(r, 'BR-DEC-17')).toMatchObject({ path: 'roundingAmount', businessTerm: 'BT-114' });
    expect(only(r, 'BR-DEC-01')).toMatchObject({ path: 'allowances[0].amount', businessTerm: 'BT-92' });
    expect(only(r, 'BR-DEC-05')).toMatchObject({ path: 'charges[0].amount', businessTerm: 'BT-99' });
    expect(only(r, 'BR-DEC-24')).toMatchObject({ path: 'lines[0].allowances[0].amount', businessTerm: 'BT-136' });
    expect(only(r, 'BR-DEC-27')).toMatchObject({ path: 'lines[0].charges[0].amount', businessTerm: 'BT-141' });
  });

  it('BR-DEC: percentage allowances/charges are not affected by the decimals rule', () => {
    const r = run({ ...base, allowances: [{ percent: '2.555', reason: 'x', vat: { category: 'S', rate: 19 } }] });
    expect(rules(r)).toEqual([]);
  });

  it('IF-DEC-001: unit price with more than 4 decimal places', () => {
    const r = run(withLines({ ...line, unitPrice: '1.23456' }));
    const v = only(r, 'IF-DEC-001');
    expect(v).toMatchObject({ path: 'lines[0].unitPrice', businessTerm: 'BT-146' });
    expect(v.message).toContain('1,23456');
    expect(rules(run(withLines({ ...line, unitPrice: '1.2345' })))).toEqual([]);
  });
});

describe('Date, period, payment due date', () => {
  it('BR-29: periodEnd before periodStart', () => {
    const r = run({ ...base, periodStart: '2026-09-10', periodEnd: '2026-09-01' });
    const v = only(r, 'BR-29');
    expect(v).toMatchObject({ path: 'periodEnd', businessTerm: 'BT-74' });
    expect(v.message).toContain('2026-09-01');
    expect(v.message).toContain('2026-09-10');
    expect(rules(run({ ...base, periodStart: '2026-09-01', periodEnd: '2026-09-01' }))).toEqual([]);
  });

  it('IF-WARN-007: billing period given only half (BR-CO-19 allows it, we warn)', () => {
    const r = run({ ...base, periodStart: '2026-09-01' });
    expect(rules(r)).toEqual([]);
    expect(warning(r, 'IF-WARN-007')).toMatchObject({ path: 'periodEnd' });
    expect(warning(run({ ...base, periodEnd: '2026-09-30' }), 'IF-WARN-007')).toMatchObject({ path: 'periodStart' });
  });

  it('IF-WARN-006 (formerly BR-CO-25): amount due > 0 without dueDate and without terms', () => {
    const { dueDate: _d, ...noDue } = base;
    const r = run(noDue);
    expect(rules(r)).toEqual([]);
    const w = warning(r, 'IF-WARN-006');
    expect(w.path).toBe('dueDate');
    // 1140.00 x 19% = 216.60; 59.80 x 7% = 4.19 -> 1199.80 + 220.79 = 1420.59
    expect(w.message).toContain('1.420,59');
  });
});

describe('Category S (standard rate)', () => {
  it('BR-S-05: rate must be > 0', () => {
    const v = only(run(withVat({ category: 'S', rate: 0 })), 'BR-S-05');
    expect(v).toMatchObject({ path: 'lines[0].vat.rate', businessTerm: 'BT-152' });
    expect(v.message).toContain('0 %');
    expect(v.hint).toContain('Z');
  });

  it('BR-S-06/BR-S-07: document level allowance/charge with S needs rate > 0', () => {
    const r = run({ ...base, allowances: [{ amount: 1, reason: 'x', vat: { category: 'S' } }], charges: [{ amount: 1, reason: 'x', vat: { category: 'S', rate: '0' } }] });
    expect(only(r, 'BR-S-06')).toMatchObject({ path: 'allowances[0].vat.rate', businessTerm: 'BT-96' });
    expect(only(r, 'BR-S-07')).toMatchObject({ path: 'charges[0].vat.rate', businessTerm: 'BT-103' });
  });

  it('BR-S-02: seller needs a VAT identifier or tax number; a tax number is sufficient', () => {
    const { vatId: _v, ...sellerNoVat } = base.seller;
    const r = run({ ...base, seller: sellerNoVat });
    const v = only(r, 'BR-S-02');
    expect(v).toMatchObject({ path: 'seller.vatId', businessTerm: 'BT-31' });
    expect(v.message).toContain('Musterwerk GmbH');
    // BR-CO-26 additionally requires vatId | legalRegistration | id
    expect(rules(run({ ...base, seller: { ...sellerNoVat, taxNumber: '93/815/08152', legalRegistration: { id: 'HRB 1' } } }))).toEqual([]);
  });

  it('BR-S-10: S must not carry a VAT exemption reason', () => {
    const r = run(withVat({ category: 'S', rate: 19, exemptionReason: 'keiner' }));
    expect(only(r, 'BR-S-10')).toMatchObject({ path: 'lines[0].vat.exemptionReason', businessTerm: 'BT-120' });
    const r2 = run(withVat({ category: 'S', rate: 19, exemptionReasonCode: 'VATEX-EU-AE' }));
    expect(only(r2, 'BR-S-10')).toMatchObject({ path: 'lines[0].vat.exemptionReasonCode', businessTerm: 'BT-121' });
  });

  it('BR-CO-17 / BR-S-08: breakdown consistency (property-style, via manipulation)', () => {
    const c = calculate(normalize(base));
    // The breakdown is sorted by rate: [0] = 7%, [1] = 19%
    const first = c.vatBreakdown[1]!;
    c.vatBreakdown[1] = { ...first, taxAmount: first.taxAmount.plus('0.01') };
    const v = only(validate(c), 'BR-CO-17');
    expect(v).toMatchObject({ path: 'vatBreakdown[1].taxAmount', businessTerm: 'BT-117' });
    expect(v.message).toContain('216,61');
    expect(v.message).toContain('1.140,00');
    expect(v.message).toContain('19 %');
    expect(v.message).toContain('expected: 216,60');

    const c2 = calculate(normalize(base));
    const f2 = c2.vatBreakdown[1]!;
    c2.vatBreakdown[1] = { ...f2, taxableAmount: f2.taxableAmount.plus('1') };
    const r2 = validate(c2);
    expect(only(r2, 'BR-S-08')).toMatchObject({ path: 'vatBreakdown[1].taxableAmount', businessTerm: 'BT-116' });
    expect(only(r2, 'BR-S-08').message).toContain('1.141,00');
  });

  it('BR-S-01: breakdown for S is missing (via manipulation)', () => {
    const c = calculate(normalize(base));
    c.vatBreakdown = [];
    const r = validate(c);
    expect(only(r, 'BR-S-01')).toMatchObject({ path: 'vatBreakdown', businessTerm: 'BT-118' });
  });
});

describe('Category Z (zero rate)', () => {
  const z = withVat({ category: 'Z', rate: 0 });
  it('valid, no findings', () => expect(rules(run(z))).toEqual([]));
  it('BR-Z-05: rate must be 0', () => {
    expect(only(run(withVat({ category: 'Z', rate: 19 })), 'BR-Z-05')).toMatchObject({ path: 'lines[0].vat.rate', businessTerm: 'BT-152' });
  });
  it('BR-Z-10: no VAT exemption reason', () => {
    expect(only(run(withVat({ category: 'Z', exemptionReasonCode: 'VATEX-EU-O' })), 'BR-Z-10')).toMatchObject({ path: 'lines[0].vat.exemptionReasonCode' });
  });
  it('BR-Z-09: tax amount in the breakdown must be 0 (via manipulation)', () => {
    const c = calculate(normalize(z));
    c.vatBreakdown[0] = { ...c.vatBreakdown[0]!, taxAmount: c.vatBreakdown[0]!.taxAmount.plus(1) };
    expect(rules(validate(c))).toContain('BR-Z-09');
  });
  it('BR-Z-02: seller identifier required', () => {
    const { vatId: _v, ...sellerNoVat } = base.seller;
    expect(only(run({ ...z, seller: sellerNoVat }), 'BR-Z-02')).toMatchObject({ path: 'seller.vatId' });
  });
});

describe('Category E (exempt from VAT)', () => {
  it('BR-E-10: a VAT exemption reason or code is mandatory (no default)', () => {
    const v = only(run(withVat({ category: 'E' })), 'BR-E-10');
    expect(v).toMatchObject({ path: 'lines[0].vat.exemptionReason', businessTerm: 'BT-120' });
    expect(v.hint).toContain('Section 4');
    expect(rules(run(withVat({ category: 'E', exemptionReason: 'Steuerfrei nach § 4 Nr. 14 UStG' })))).toEqual([]);
    expect(rules(run(withVat({ category: 'E', exemptionReasonCode: 'VATEX-EU-132-1C' })))).toEqual([]);
  });
  it('BR-E-05: rate must be 0', () => {
    expect(only(run(withVat({ category: 'E', rate: 7, exemptionReason: 'x' })), 'BR-E-05')).toMatchObject({ path: 'lines[0].vat.rate' });
  });
  it('BR-E-02: seller identifier required', () => {
    const { vatId: _v, ...sellerNoVat } = base.seller;
    expect(only(run({ ...withVat({ category: 'E', exemptionReason: 'x' }), seller: sellerNoVat }), 'BR-E-02')).toMatchObject({ path: 'seller.vatId' });
  });
  it('IF-WARN-011: conflicting VAT exemption reasons within one category', () => {
    const r = run(withLines({ ...line, vat: { category: 'E', exemptionReason: 'A' } }, { ...line, vat: { category: 'E', exemptionReason: 'B' } }));
    expect(rules(r)).toEqual([]);
    expect(warning(r, 'IF-WARN-011')).toMatchObject({ path: 'lines[1].vat.exemptionReason' });
  });
});

describe('Category AE (reverse charge)', () => {
  const ae = withVat({ category: 'AE' });
  const buyerVat = { ...base.buyer, vatId: 'ATU12345678', address: { ...base.buyer.address, country: 'AT' } };

  it('valid with both VAT identifiers, VAT exemption reason is pre-filled', () => {
    expect(run({ ...ae, buyer: buyerVat })).toEqual({ violations: [], warnings: [] });
  });

  it('BR-AE-02: buyer without a VAT identifier -> exactly one violation', () => {
    const r = run(ae);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ rule: 'BR-AE-02', path: 'buyer.vatId', businessTerm: 'BT-48' });
    expect(r.violations[0]!.message).toBe('For reverse charge, the VAT identifier of the recipient is required.');
    expect(r.violations[0]!.hint).toContain('buyer.vatId');
  });

  it('BR-AE-02: a buyer legal registration number (BT-47) is a valid alternative', () => {
    expect(rules(run({ ...ae, buyer: { ...base.buyer, legalRegistration: { id: 'HRB 99' } } }))).toEqual([]);
  });

  it('BR-AE-02: seller without an identifier -> seller.vatId', () => {
    const { vatId: _v, ...sellerNoVat } = base.seller;
    const r = run({ ...ae, buyer: buyerVat, seller: sellerNoVat });
    expect(only(r, 'BR-AE-02')).toMatchObject({ path: 'seller.vatId', businessTerm: 'BT-31' });
  });

  it('BR-AE-03/BR-AE-04: allowance/charge with AE needs the same identifiers', () => {
    const r = run({ ...base, allowances: [{ amount: 1, reason: 'x', vat: { category: 'AE' } }], charges: [{ amount: 1, reason: 'x', vat: { category: 'AE' } }] });
    expect(only(r, 'BR-AE-03')).toMatchObject({ path: 'buyer.vatId', businessTerm: 'BT-48' });
    expect(only(r, 'BR-AE-04')).toMatchObject({ path: 'buyer.vatId', businessTerm: 'BT-48' });
  });

  it('BR-AE-05/06/07: rate must be 0', () => {
    const r = run({
      ...base,
      buyer: buyerVat,
      lines: [{ ...line, vat: { category: 'AE', rate: 19 } }],
      allowances: [{ amount: 1, reason: 'x', vat: { category: 'AE', rate: 19 } }],
      charges: [{ amount: 1, reason: 'x', vat: { category: 'AE', rate: 19 } }],
    });
    expect(only(r, 'BR-AE-05')).toMatchObject({ path: 'lines[0].vat.rate' });
    expect(only(r, 'BR-AE-06')).toMatchObject({ path: 'allowances[0].vat.rate' });
    expect(only(r, 'BR-AE-07')).toMatchObject({ path: 'charges[0].vat.rate' });
    expect(only(r, 'BR-AE-05').message).toContain('19 %');
  });

  it('BR-AE-10: VAT exemption reason missing (via manipulation, since normalize pre-fills it)', () => {
    const c = calculate(normalize({ ...ae, buyer: buyerVat }));
    for (const l of c.lines) {
      delete l.vat.exemptionReason;
      delete l.vat.exemptionReasonCode;
    }
    expect(only(validate(c), 'BR-AE-10')).toMatchObject({ path: 'lines[0].vat.exemptionReason', businessTerm: 'BT-120' });
  });

  it('BR-AE-09: tax amount must be 0 (via manipulation)', () => {
    const c = calculate(normalize({ ...ae, buyer: buyerVat }));
    c.vatBreakdown[0] = { ...c.vatBreakdown[0]!, taxAmount: c.vatBreakdown[0]!.taxAmount.plus(1) };
    expect(only(validate(c), 'BR-AE-09')).toMatchObject({ path: 'vatBreakdown[0].taxAmount', businessTerm: 'BT-117' });
  });
});

describe('Category K (intra-community supply, BR-IC)', () => {
  const buyerAt = { ...base.buyer, vatId: 'ATU12345678', address: { ...base.buyer.address, country: 'AT', city: 'Wien', postalCode: '1010' } };
  const { deliveryDate: _dd, ...baseNoAlias } = withVat({ category: 'K' });
  const k: InvoiceInput = { ...baseNoAlias, buyer: buyerAt, delivery: { date: '2026-09-10', address: { street: 'Ring 1', city: 'Wien', postalCode: '1010', country: 'AT' } } };

  it('valid, no findings', () => expect(run(k)).toEqual({ violations: [], warnings: [] }));

  it('BR-IC-02: a seller tax number is NOT sufficient, a VAT identifier is required', () => {
    const { vatId: _v, ...sellerNoVat } = base.seller;
    const r = run({ ...k, seller: { ...sellerNoVat, taxNumber: '93/815/08152', legalRegistration: { id: 'HRB 1' } } });
    expect(only(r, 'BR-IC-02')).toMatchObject({ path: 'seller.vatId', businessTerm: 'BT-31' });
  });

  it('BR-IC-02: buyer without a VAT identifier', () => {
    const r = run({ ...k, buyer: { ...buyerAt, vatId: undefined } });
    expect(only(r, 'BR-IC-02')).toMatchObject({ path: 'buyer.vatId', businessTerm: 'BT-48' });
  });

  it('BR-IC-05: rate 0', () => {
    expect(only(run({ ...k, lines: [{ ...line, vat: { category: 'K', rate: 20 } }] }), 'BR-IC-05')).toMatchObject({ path: 'lines[0].vat.rate' });
  });

  it('BR-IC-11: delivery date or billing period required', () => {
    const r = run({ ...k, delivery: { address: k.delivery!.address! } });
    expect(only(r, 'BR-IC-11')).toMatchObject({ path: 'delivery.date', businessTerm: 'BT-72' });
    expect(rules(run({ ...k, delivery: { address: k.delivery!.address! }, periodStart: '2026-09-01', periodEnd: '2026-09-30' }))).toEqual([]);
  });

  it('BR-IC-12: delivery address with country required', () => {
    const r = run({ ...k, delivery: { date: '2026-09-10' } });
    const v = only(r, 'BR-IC-12');
    expect(v).toMatchObject({ path: 'delivery.address.country', businessTerm: 'BT-80' });
    expect(v.hint).toContain('delivery.address');
  });

  it('BR-IC-10: VAT exemption reason (via manipulation)', () => {
    const c = calculate(normalize(k));
    for (const l of c.lines) {
      delete l.vat.exemptionReason;
      delete l.vat.exemptionReasonCode;
    }
    expect(only(validate(c), 'BR-IC-10')).toMatchObject({ path: 'lines[0].vat.exemptionReason' });
  });
});

describe('Category G (export)', () => {
  const g = withVat({ category: 'G' });
  it('valid, no findings', () => expect(rules(run(g))).toEqual([]));
  it('BR-G-02: seller VAT identifier (a tax number is not sufficient)', () => {
    const { vatId: _v, ...sellerNoVat } = base.seller;
    expect(only(run({ ...g, seller: { ...sellerNoVat, taxNumber: '1', legalRegistration: { id: 'x' } } }), 'BR-G-02')).toMatchObject({ path: 'seller.vatId' });
  });
  it('BR-G-05: rate 0', () => {
    expect(only(run(withVat({ category: 'G', rate: 1 })), 'BR-G-05')).toMatchObject({ path: 'lines[0].vat.rate' });
  });
  it('BR-G-10: VAT exemption reason (via manipulation)', () => {
    const c = calculate(normalize(g));
    for (const l of c.lines) {
      delete l.vat.exemptionReason;
      delete l.vat.exemptionReasonCode;
    }
    expect(only(validate(c), 'BR-G-10')).toMatchObject({ path: 'lines[0].vat.exemptionReason' });
  });
});

describe('Category O (not subject to VAT)', () => {
  const { vatId: _v, ...sellerNoVat } = base.seller;
  const o: InvoiceInput = { ...withVat({ category: 'O' }), seller: { ...sellerNoVat, legalRegistration: { id: 'HRB 1' } } };

  it('valid, no findings', () => expect(run(o)).toEqual({ violations: [], warnings: [] }));

  it('BR-O-02: a VAT identifier of the seller or buyer must not be given', () => {
    const r = run({ ...o, seller: { ...o.seller, vatId: 'DE123456789' }, buyer: { ...base.buyer, vatId: 'DE987654321' } });
    const hits = r.violations.filter((v) => v.rule === 'BR-O-02');
    expect(hits.map((v) => v.path).sort()).toEqual(['buyer.vatId', 'seller.vatId']);
    expect(hits[0]!.hint).toContain('E');
  });

  it('BR-O-05: no VAT rate', () => {
    expect(only(run({ ...o, lines: [{ ...line, vat: { category: 'O', rate: 19 } }] }), 'BR-O-05')).toMatchObject({ path: 'lines[0].vat.rate' });
  });

  it('BR-O-11/12/13/14: no mixing with other categories', () => {
    const r = run({
      ...o,
      lines: [line, { ...line, vat: { category: 'O' } }],
      allowances: [{ amount: 1, reason: 'x', vat: { category: 'S', rate: 19 } }],
      charges: [{ amount: 1, reason: 'x', vat: { category: 'S', rate: 19 } }],
    });
    expect(only(r, 'BR-O-11')).toMatchObject({ path: 'vatBreakdown', businessTerm: 'BT-118' });
    expect(only(r, 'BR-O-12')).toMatchObject({ path: 'lines[0].vat.category', businessTerm: 'BT-151' });
    expect(only(r, 'BR-O-13')).toMatchObject({ path: 'allowances[0].vat.category', businessTerm: 'BT-95' });
    expect(only(r, 'BR-O-14')).toMatchObject({ path: 'charges[0].vat.category', businessTerm: 'BT-102' });
    expect(only(r, 'BR-O-11').message).toContain('S');
  });

  it('BR-O-10: VAT exemption reason (via manipulation)', () => {
    const c = calculate(normalize(o));
    for (const l of c.lines) {
      delete l.vat.exemptionReason;
      delete l.vat.exemptionReasonCode;
    }
    expect(only(validate(c), 'BR-O-10')).toMatchObject({ path: 'lines[0].vat.exemptionReason' });
  });
});

describe('Categories L (IGIC) and M (IPSI), structural only', () => {
  it('BR-AF-05: L needs rate > 0; BR-AF-10: no VAT exemption reason', () => {
    expect(only(run(withVat({ category: 'L', rate: 0 })), 'BR-AF-05')).toMatchObject({ path: 'lines[0].vat.rate' });
    expect(only(run(withVat({ category: 'L', rate: 7, exemptionReason: 'x' })), 'BR-AF-10')).toMatchObject({ path: 'lines[0].vat.exemptionReason' });
    expect(rules(run(withVat({ category: 'L', rate: 7 })))).toEqual([]);
  });
  it('BR-AG-05: M allows rate >= 0; BR-AG-10: no VAT exemption reason', () => {
    expect(rules(run(withVat({ category: 'M', rate: 0 })))).toEqual([]);
    expect(rules(run(withVat({ category: 'M', rate: 10 })))).toEqual([]);
    expect(only(run(withVat({ category: 'M', rate: -1 })), 'BR-AG-05')).toMatchObject({ path: 'lines[0].vat.rate' });
    expect(only(run(withVat({ category: 'M', rate: 1, exemptionReasonCode: 'x' })), 'BR-AG-10')).toMatchObject({ path: 'lines[0].vat.exemptionReasonCode' });
  });
});

describe('Seller identification and VAT identifier format', () => {
  it('BR-CO-26: seller needs vatId, legalRegistration, or id; a tax number alone is not sufficient', () => {
    const { vatId: _v, ...sellerNoVat } = base.seller;
    const r = run({ ...base, seller: { ...sellerNoVat, taxNumber: '93/815/08152' } });
    const v = only(r, 'BR-CO-26');
    expect(v).toMatchObject({ path: 'seller.vatId', businessTerm: 'BT-31' });
    expect(v.hint).toContain('legalRegistration');
    expect(rules(run({ ...base, seller: { ...sellerNoVat, taxNumber: '93/815/08152', id: 'L-1' } }))).toEqual([]);
  });

  it('BR-CO-09: VAT identifier must start with a country prefix (EL for Greece allowed)', () => {
    const r = run({ ...base, seller: { ...base.seller, vatId: '123456789' }, buyer: { ...base.buyer, vatId: 'ZZ123' } });
    const hits = r.violations.filter((v) => v.rule === 'BR-CO-09');
    expect(hits.map((v) => v.path).sort()).toEqual(['buyer.vatId', 'seller.vatId']);
    expect(hits.find((v) => v.path === 'seller.vatId')).toMatchObject({ businessTerm: 'BT-31' });
    expect(hits.find((v) => v.path === 'buyer.vatId')).toMatchObject({ businessTerm: 'BT-48' });
    expect(rules(run({ ...base, buyer: { ...base.buyer, vatId: 'EL123456789' } }))).toEqual([]);
  });

  it('IF-VAT-001: German VAT identifier = DE plus 9 digits', () => {
    const r = run({ ...base, seller: { ...base.seller, vatId: 'DE12345678' } });
    const v = only(r, 'IF-VAT-001');
    expect(v).toMatchObject({ path: 'seller.vatId', businessTerm: 'BT-31' });
    expect(v.message).toContain('DE12345678');
    expect(rules(run({ ...base, seller: { ...base.seller, vatId: 'DE 123 456 789' } }))).toEqual([]);
    expect(only(run({ ...base, buyer: { ...base.buyer, vatId: 'DE1234567890' } }), 'IF-VAT-001')).toMatchObject({ path: 'buyer.vatId', businessTerm: 'BT-48' });
  });
});

describe('Payment: IBAN, BIC, direct debit', () => {
  it('IF-PAY-001: invalid seller IBAN (checksum) with a reason', () => {
    const v = only(run({ ...base, payment: { means: 'transfer', iban: 'DE89370400440532013001' } }), 'IF-PAY-001');
    expect(v).toMatchObject({ path: 'payment.iban', businessTerm: 'BT-84' });
    expect(v.message).toContain('DE89370400440532013001');
    expect(v.message).toContain('checksum');
  });

  it('IF-PAY-001: wrong length', () => {
    expect(only(run({ ...base, payment: { means: 'transfer', iban: 'DE8937040044053201300' } }), 'IF-PAY-001').message).toContain('22');
  });

  it('IF-PAY-002: invalid buyer IBAN (debitedIban)', () => {
    const r = run({ ...base, payment: { means: 'sepa-direct-debit', debitedIban: 'DE00', creditorId: 'DE98ZZZ09999999999', mandateReference: 'M' } });
    expect(only(r, 'IF-PAY-002')).toMatchObject({ path: 'payment.debitedIban', businessTerm: 'BT-91' });
  });

  it('IF-PAY-003: invalid BIC', () => {
    const v = only(run({ ...base, payment: { ...base.payment!, bic: 'COBA' } }), 'IF-PAY-003');
    expect(v).toMatchObject({ path: 'payment.bic', businessTerm: 'BT-86' });
    expect(v.message).toContain('COBA');
  });

  it('IF-PAY-004: invalid creditor identifier', () => {
    const r = run({ ...base, payment: { means: '59', debitedIban: 'DE89370400440532013000', creditorId: 'DE97ZZZ09999999999', mandateReference: 'M' } });
    const v = only(r, 'IF-PAY-004');
    expect(v).toMatchObject({ path: 'payment.creditorId', businessTerm: 'BT-90' });
    expect(v.message).toContain('DE97ZZZ09999999999');
  });

  it('direct debit complete: no findings', () => {
    const r = run({ ...base, payment: { means: 'sepa-direct-debit', debitedIban: 'DE89370400440532013000', creditorId: 'DE98ZZZ09999999999', mandateReference: 'M-2026-1' } });
    expect(r).toEqual({ violations: [], warnings: [] });
  });

  it('direct debit outside XRechnung: missing fields are warnings IF-WARN-008/009/010', () => {
    const r = run({ ...base, payment: { means: 'sepa-direct-debit' } });
    expect(rules(r)).toEqual([]);
    expect(warning(r, 'IF-WARN-008')).toMatchObject({ path: 'payment.mandateReference', businessTerm: 'BT-89' });
    expect(warning(r, 'IF-WARN-009')).toMatchObject({ path: 'payment.creditorId', businessTerm: 'BT-90' });
    expect(warning(r, 'IF-WARN-010')).toMatchObject({ path: 'payment.debitedIban', businessTerm: 'BT-91' });
  });

  it('IF-WARN-016: credit transfer without an IBAN outside XRechnung is only a warning', () => {
    const r = run({ ...base, payment: { means: 'transfer' } });
    expect(rules(r)).toEqual([]);
    expect(warning(r, 'IF-WARN-016')).toMatchObject({ path: 'payment.iban', businessTerm: 'BT-84' });
    expect(run({ ...base, payment: { means: '30' } }).warnings.map((w) => w.code)).toContain('IF-WARN-016');
    expect(run({ ...base, payment: { means: 'cash' } }).warnings).toEqual([]);
  });
});

describe('Profile XRechnung (BR-DE-*)', () => {
  const xr: InvoiceInput = { ...base, profile: 'xrechnung', buyerReference: '04011000-12345-03' };

  it('complete XRechnung: no findings', () => {
    expect(run(xr)).toEqual({ violations: [], warnings: [] });
  });

  it('BR-DE-1: payment data mandatory', () => {
    const { payment: _p, ...noPay } = xr;
    expect(only(run(noPay), 'BR-DE-1')).toMatchObject({ path: 'payment', businessTerm: 'BG-16' });
  });

  it('BR-DE-2/5/6/7: seller contact with name, phone, email', () => {
    const { contact: _c, ...sellerNoContact } = xr.seller;
    expect(only(run({ ...xr, seller: sellerNoContact }), 'BR-DE-2')).toMatchObject({ path: 'seller.contact', businessTerm: 'BG-6' });
    const r = run({ ...xr, seller: { ...xr.seller, contact: {} } });
    expect(only(r, 'BR-DE-5')).toMatchObject({ path: 'seller.contact.name', businessTerm: 'BT-41' });
    expect(only(r, 'BR-DE-6')).toMatchObject({ path: 'seller.contact.phone', businessTerm: 'BT-42' });
    expect(only(r, 'BR-DE-7')).toMatchObject({ path: 'seller.contact.email', businessTerm: 'BT-43' });
    expect(rules(r)).not.toContain('BR-DE-2');
  });

  it('BR-DE-27: phone number with fewer than 3 digits (warning)', () => {
    const r = run({ ...xr, seller: { ...xr.seller, contact: { ...xr.seller.contact, phone: '+4-9' } } });
    expect(rules(r)).toEqual([]);
    expect(warning(r, 'BR-DE-27')).toMatchObject({ path: 'seller.contact.phone', businessTerm: 'BT-42' });
  });

  it('BR-DE-15: buyer reference (Leitweg-ID) mandatory', () => {
    const { buyerReference: _b, ...noRef } = xr;
    const v = only(run(noRef), 'BR-DE-15');
    expect(v).toMatchObject({ path: 'buyerReference', businessTerm: 'BT-10' });
    expect(v.hint).toContain('Leitweg');
  });

  it('BR-DE-18: early payment discount lines in payment.terms must match the XRechnung format', () => {
    const ok = run({ ...xr, payment: { ...xr.payment!, terms: 'Zahlbar in 14 Tagen.\n#SKONTO#TAGE=7#PROZENT=2.00#\n#SKONTO#TAGE=14#PROZENT=1.00#BASISBETRAG=1000.00#' } });
    expect(rules(ok)).toEqual([]);
    const bad = run({ ...xr, payment: { ...xr.payment!, terms: '#SKONTO#TAGE=7#PROZENT=2#' } });
    const v = only(bad, 'BR-DE-18');
    expect(v).toMatchObject({ path: 'payment.terms', businessTerm: 'BT-20' });
    expect(v.message).toContain('#SKONTO#TAGE=7#PROZENT=2#');
    expect(v.hint).toContain('PROZENT=2.00');
    // Second KoSIT condition (line break after the last discount entry): normalize() adds it, here via manipulation:
    const c = calculate(normalize({ ...xr, payment: { ...xr.payment!, terms: '#SKONTO#TAGE=7#PROZENT=2.00#' } }));
    expect(validate(c).violations).toEqual([]);
    c.payment!.terms = '#SKONTO#TAGE=7#PROZENT=2.00#';
    expect(validate(c).violations.map((x) => x.rule)).toEqual(['BR-DE-18']);
  });

  it('IF-XR-001/002: electronic addresses of the seller and buyer are mandatory', () => {
    const { electronicAddress: _s, ...sellerNoEa } = xr.seller;
    const { electronicAddress: _b, ...buyerNoEa } = xr.buyer;
    const r = run({ ...xr, seller: sellerNoEa, buyer: buyerNoEa });
    expect(only(r, 'IF-XR-001')).toMatchObject({ path: 'seller.electronicAddress', businessTerm: 'BT-34' });
    expect(only(r, 'IF-XR-002')).toMatchObject({ path: 'buyer.electronicAddress', businessTerm: 'BT-49' });
    expect(only(r, 'IF-XR-002').hint).toContain('EM');
  });

  it('BR-DE-23-a: a credit transfer without an IBAN is an error in XRechnung (not IF-WARN-016)', () => {
    const r = run({ ...xr, payment: { means: 'transfer' } });
    expect(only(r, 'BR-DE-23-a')).toMatchObject({ path: 'payment.iban', businessTerm: 'BT-84' });
    expect(r.warnings.map((w) => w.code)).not.toContain('IF-WARN-016');
  });

  it('BR-DE-23-b: a credit transfer must not contain direct debit data', () => {
    const r = run({ ...xr, payment: { ...xr.payment!, debitedIban: 'DE89370400440532013000' } });
    expect(only(r, 'BR-DE-23-b')).toMatchObject({ path: 'payment.debitedIban' });
  });

  it('BR-DE-30/31: direct debit needs the creditor identifier and buyer IBAN; a missing mandate is a warning', () => {
    const r = run({ ...xr, payment: { means: 'sepa-direct-debit' } });
    expect(only(r, 'BR-DE-30')).toMatchObject({ path: 'payment.creditorId', businessTerm: 'BT-90' });
    expect(only(r, 'BR-DE-31')).toMatchObject({ path: 'payment.debitedIban', businessTerm: 'BT-91' });
    expect(warning(r, 'IF-WARN-008')).toMatchObject({ path: 'payment.mandateReference' });
    expect(r.warnings.map((w) => w.code)).not.toContain('IF-WARN-009');
    expect(r.warnings.map((w) => w.code)).not.toContain('IF-WARN-010');
  });

  it('BR-DE-25-b: a direct debit must not contain credit transfer data', () => {
    const r = run({ ...xr, payment: { means: '59', iban: 'DE89370400440532013000', debitedIban: 'DE89370400440532013000', creditorId: 'DE98ZZZ09999999999', mandateReference: 'M' } });
    expect(only(r, 'BR-DE-25-b')).toMatchObject({ path: 'payment.iban' });
  });

  it('XRechnung rules do not apply in other profiles', () => {
    const { buyerReference: _b, ...noRef } = base;
    expect(rules(run({ ...noRef, profile: 'extended' }))).toEqual([]);
  });
});

describe('Profile Factur-X BASIC', () => {
  const basic: InvoiceInput = { ...base, profile: 'basic' };

  it('IF-PROFILE-001: percentage line allowances/charges cannot be represented in BASIC (BT-138/BT-143 missing)', () => {
    const r = run({ ...basic, lines: [{ ...line, allowances: [{ percent: 10, reason: 'Rabatt' }], charges: [{ amount: 1, reason: 'Fracht' }] }] });
    const v = only(r, 'IF-PROFILE-001');
    expect(v).toMatchObject({ path: 'lines[0].allowances[0].percent', businessTerm: 'BT-138' });
    expect(v.hint).toContain('amount');
    expect(rules(run({ ...basic, lines: [{ ...line, allowances: [{ amount: 5, reason: 'Rabatt' }] }] }))).toEqual([]);
    // Document level allows percentages
    expect(rules(run({ ...basic, allowances: [{ percent: 10, reason: 'Rabatt', vat: { category: 'S', rate: 19 } }] }))).toEqual([]);
  });

  it('IF-PROFILE-002: a non-zero rounding amount cannot be represented in BASIC (BT-114 missing from the XSD)', () => {
    const v = only(run({ ...basic, roundingAmount: '0.01' }), 'IF-PROFILE-002');
    expect(v).toMatchObject({ path: 'roundingAmount', businessTerm: 'BT-114' });
    expect(v.message).toContain('0,01');
    expect(rules(run({ ...basic, roundingAmount: 0 }))).toEqual([]);
    expect(rules(run({ ...base, roundingAmount: '0.01' }))).toEqual([]);
  });

  it('IF-WARN-012/013/014: fields not represented in BASIC are reported as a warning (description, contact, BIC)', () => {
    const r = run({ ...basic, lines: [{ ...line, description: 'Langtext' }], buyer: { ...basic.buyer, contact: { name: 'Einkauf' } } });
    expect(rules(r)).toEqual([]);
    expect(warning(r, 'IF-WARN-012')).toMatchObject({ path: 'lines[0].description', businessTerm: 'BT-154' });
    const contacts = r.warnings.filter((w) => w.code === 'IF-WARN-013').map((w) => w.path).sort();
    expect(contacts).toEqual(['buyer.contact', 'seller.contact']);
    expect(warning(r, 'IF-WARN-014')).toMatchObject({ path: 'payment.bic', businessTerm: 'BT-86' });
  });

  it('en16931 profile: no BASIC warnings', () => {
    expect(run({ ...base, lines: [{ ...line, description: 'Langtext' }] }).warnings).toEqual([]);
  });
});

describe('Totals consistency BR-CO-10...16 (property-style, via manipulation)', () => {
  it.each([
    ['BR-CO-10', 'lineTotal', 'BT-106'],
    ['BR-CO-11', 'allowanceTotal', 'BT-107'],
    ['BR-CO-12', 'chargeTotal', 'BT-108'],
    ['BR-CO-13', 'taxExclusiveAmount', 'BT-109'],
    ['BR-CO-14', 'taxTotal', 'BT-110'],
    ['BR-CO-15', 'taxInclusiveAmount', 'BT-112'],
    ['BR-CO-16', 'payableAmount', 'BT-115'],
  ] as const)('%s: totals.%s tampered → violation with %s', (rule, field, bt) => {
    const c = calculate(normalize(base));
    c.totals[field] = c.totals[field].plus('0.01');
    const r = validate(c);
    const v = r.violations.find((x) => x.rule === rule);
    expect(v, JSON.stringify(rules(r))).toMatchObject({ path: `totals.${field}`, businessTerm: bt });
    expect(v!.message).toContain('expected');
  });
});

describe('Further warnings', () => {
  it('IF-WARN-001: quantity 0', () => {
    const w = warning(run(withLines(line, { ...line, name: 'Muster', quantity: 0 })), 'IF-WARN-001');
    expect(w).toMatchObject({ path: 'lines[1].quantity', businessTerm: 'BT-129' });
    expect(w.message).toContain('Muster');
  });

  it('IF-WARN-002: neither a delivery date nor a period (Section 14 UStG)', () => {
    const { deliveryDate: _d, ...noDelivery } = base;
    const w = warning(run(noDelivery), 'IF-WARN-002');
    expect(w.path).toBe('delivery.date');
    expect(w.hint).toContain('Section 14');
    expect(run({ ...noDelivery, periodStart: '2026-09-01', periodEnd: '2026-09-30' }).warnings).toEqual([]);
  });

  it('IF-WARN-003: correction without precedingInvoices', () => {
    const w = warning(run({ ...base, type: 'correction' }), 'IF-WARN-003');
    expect(w).toMatchObject({ path: 'precedingInvoices', businessTerm: 'BG-3' });
    expect(w.message).toContain('RE-2026-00042');
    expect(run({ ...base, type: 'correction', precedingInvoices: [{ number: 'RE-1' }] }).warnings).toEqual([]);
  });

  it('IF-WARN-004: total amount 0', () => {
    const w = warning(run(withLines({ ...line, unitPrice: 0 })), 'IF-WARN-004');
    expect(w.message).toContain('0,00');
  });

  it('IF-WARN-005: S with an unusual rate in DE', () => {
    const w = warning(run(withVat({ category: 'S', rate: 16 })), 'IF-WARN-005');
    expect(w).toMatchObject({ path: 'lines[0].vat.rate' });
    expect(w.message).toContain('16 %');
    const at = { ...base, seller: { ...base.seller, vatId: 'ATU12345678', address: { ...base.seller.address, country: 'AT' } } };
    expect(run({ ...at, lines: [{ ...line, vat: { category: 'S', rate: 20 } }] }).warnings).toEqual([]);
  });

  it('IF-WARN-015: dueDate before issueDate', () => {
    const w = warning(run({ ...base, dueDate: '2026-09-01' }), 'IF-WARN-015');
    expect(w.message).toContain('2026-09-01');
    expect(w.message).toContain('2026-09-12');
  });

  it('IF-WARN-017: quantity with more than 4 decimal places', () => {
    expect(warning(run(withLines({ ...line, quantity: '1.23456' })), 'IF-WARN-017')).toMatchObject({ path: 'lines[0].quantity' });
  });
});
