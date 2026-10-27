import { describe, expect, it } from 'vitest';
import { InvoiceError } from '../errors/index.js';
import type { InvoiceInput } from '../model/input.js';
import { normalize } from './normalize.js';

const base: InvoiceInput = {
  number: 'RE-2026-00042',
  issueDate: '2026-09-12',
  seller: {
    name: 'Musterwerk GmbH',
    address: { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' },
    vatId: 'DE123456789',
  },
  buyer: {
    name: 'Beispiel & Söhne KG',
    address: { street: 'Hauptstraße 1', city: 'Berlin', postalCode: '10115', country: 'DE' },
  },
  lines: [{ name: 'Beratung', quantity: 12, unit: 'Stunde', unitPrice: '95.00', vat: { category: 'S', rate: 19 } }],
};

function violationsOf(fn: () => unknown): InvoiceError['violations'] {
  try {
    fn();
  } catch (e) {
    if (e instanceof InvoiceError) return e.violations;
    throw e;
  }
  throw new Error('Erwartet: InvoiceError');
}

describe('normalize – defaults and codes', () => {
  it('sets profile, URN, currency, type code and empty lists', () => {
    const n = normalize(base);
    expect(n.profile).toBe('en16931');
    expect(n.profileUrn).toBe('urn:cen.eu:en16931:2017');
    expect(n.currency).toBe('EUR');
    expect(n.typeCode).toBe('380');
    expect(n.notes).toEqual([]);
    expect(n.allowances).toEqual([]);
    expect(n.charges).toEqual([]);
    expect(n.prepaidAmount.toString()).toBe('0');
    expect(n.roundingAmount.toString()).toBe('0');
    expect(n.payment).toBeUndefined();
  });

  it('maps profile to URN', () => {
    expect(normalize({ ...base, profile: 'basic' }).profileUrn).toContain('factur-x.eu:1p0:basic');
    expect(normalize({ ...base, profile: 'extended' }).profileUrn).toContain('factur-x.eu:1p0:extended');
    expect(normalize({ ...base, profile: 'xrechnung' }).profileUrn).toContain('xrechnung_3.0');
  });

  it('maps type aliases to UNTDID 1001 codes', () => {
    expect(normalize({ ...base, type: 'credit-note' }).typeCode).toBe('381');
    expect(normalize({ ...base, type: 'correction' }).typeCode).toBe('384');
    expect(normalize({ ...base, type: '381' }).typeCode).toBe('381');
  });

  it('assigns line IDs sequentially from 1, keeps explicit IDs', () => {
    const line = base.lines[0]!;
    const n = normalize({ ...base, lines: [line, { ...line, id: 'X-7' }, line] });
    expect(n.lines.map((l) => l.id)).toEqual(['1', 'X-7', '3']);
  });

  it('sets priceBaseQuantity=1 and VAT rate 0 as defaults, parses amounts to Decimal', () => {
    const n = normalize({ ...base, lines: [{ name: 'Frei', quantity: '2.5', unit: 'kg', unitPrice: 3.1234, vat: { category: 'E' } }] });
    const l = n.lines[0]!;
    expect(l.priceBaseQuantity.toString()).toBe('1');
    expect(l.vat.rate.toString()).toBe('0');
    expect(l.quantity.toString()).toBe('2.5');
    expect(l.unitPrice.toString()).toBe('3.1234');
    expect(l.unitCode).toBe('KGM');
    expect(l.allowances).toEqual([]);
    expect(l.charges).toEqual([]);
  });

  it('maps unit aliases case-insensitively and passes codes through', () => {
    const line = base.lines[0]!;
    const units = ['Stück', 'STK', 'pcs', 'h', 'Hour', 'Tag', 'day', 'kg', 'm', 'Pauschale', 'lump', 'l', 'Liter', 'm²', 'Monat', 'month', 'C62', 'HUR', 'XYZ', 'E48'];
    const n = normalize({ ...base, lines: units.map((unit) => ({ ...line, unit })) });
    expect(n.lines.map((l) => l.unitCode)).toEqual([
      'C62', 'C62', 'C62', 'HUR', 'HUR', 'DAY', 'DAY', 'KGM', 'MTR', 'LS', 'LS', 'LTR', 'LTR', 'MTK', 'MON', 'MON', 'C62', 'HUR', 'XYZ', 'E48',
    ]);
  });

  it('maps payment means aliases to UNTDID 4461 codes', () => {
    expect(normalize({ ...base, payment: { means: 'transfer', iban: 'DE89370400440532013000' } }).payment).toEqual({
      meansCode: '58',
      iban: 'DE89370400440532013000',
    });
    expect(normalize({ ...base, payment: { means: 'sepa-direct-debit' } }).payment?.meansCode).toBe('59');
    expect(normalize({ ...base, payment: { means: 'card' } }).payment?.meansCode).toBe('48');
    expect(normalize({ ...base, payment: { means: 'cash' } }).payment?.meansCode).toBe('10');
    expect(normalize({ ...base, payment: { means: '30' } }).payment?.meansCode).toBe('30');
  });

  it('passes parties through unchanged, including optional fields', () => {
    const n = normalize({
      ...base,
      buyer: { ...base.buyer, contact: { email: 'a@b.de' }, electronicAddress: { scheme: 'EM', value: 'a@b.de' } },
    });
    expect(n.seller.vatId).toBe('DE123456789');
    expect(n.seller.taxNumber).toBeUndefined();
    expect(n.buyer.contact).toEqual({ email: 'a@b.de' });
    expect(n.buyer.electronicAddress).toEqual({ scheme: 'EM', value: 'a@b.de' });
  });

  it('normalizes allowances/charges on line and document (amount|percent)', () => {
    const line = base.lines[0]!;
    const n = normalize({
      ...base,
      lines: [{ ...line, allowances: [{ amount: '5', reason: 'Treue' }], charges: [{ percent: 2.5, reasonCode: 'FC' }] }],
      allowances: [{ percent: 10, vat: { category: 'S', rate: 19 }, reason: 'Skonto' }],
      charges: [{ amount: 4.9, vat: { category: 'S', rate: '19' } }],
      prepaidAmount: '100',
      roundingAmount: -0.01,
    });
    expect(n.lines[0]!.allowances).toEqual([{ value: { kind: 'amount', amount: expect.anything() }, reason: 'Treue' }]);
    expect(n.lines[0]!.allowances[0]!.value.kind === 'amount' && n.lines[0]!.allowances[0]!.value.amount.toString()).toBe('5');
    expect(n.lines[0]!.charges[0]!.value.kind === 'percent' && n.lines[0]!.charges[0]!.value.percent.toString()).toBe('2.5');
    expect(n.lines[0]!.charges[0]!.reasonCode).toBe('FC');
    expect(n.allowances[0]!.vat.category).toBe('S');
    expect(n.allowances[0]!.vat.rate.toString()).toBe('19');
    expect(n.allowances[0]!.value.kind).toBe('percent');
    expect(n.charges[0]!.value.kind === 'amount' && n.charges[0]!.value.amount.toString()).toBe('4.9');
    expect(n.charges[0]!.vat.rate.toString()).toBe('19');
    expect(n.prepaidAmount.toString()).toBe('100');
    expect(n.roundingAmount.toString()).toBe('-0.01');
  });

  it('is deterministic and pure (input stays unchanged)', () => {
    const input = structuredClone(base);
    const a = normalize(input);
    const b = normalize(input);
    expect(input).toEqual(base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('normalize – error cases', () => {
  it('unknown unit → IF-NORM-001 with path and alias hint', () => {
    const line = base.lines[0]!;
    const v = violationsOf(() => normalize({ ...base, lines: [line, { ...line, unit: 'Kiste' }] }));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: 'IF-NORM-001', path: 'lines[1].unit', businessTerm: 'BT-130' });
    expect(v[0]!.message).toContain('Kiste');
    expect(v[0]!.hint).toContain('C62');
    expect(v[0]!.hint).toContain('piece');
  });

  it('unparsable amount (comma) → IF-NORM-010 with path', () => {
    const line = base.lines[0]!;
    const v = violationsOf(() => normalize({ ...base, lines: [{ ...line, unitPrice: '1.234,50' }] }));
    expect(v[0]).toMatchObject({ rule: 'IF-NORM-010', path: 'lines[0].unitPrice', businessTerm: 'BT-146' });
    expect(v[0]!.message).toContain('comma');
  });

  it('collects multiple errors in one go', () => {
    const line = base.lines[0]!;
    const v = violationsOf(() =>
      normalize({
        ...base,
        lines: [
          { ...line, unit: 'Kiste', quantity: 'abc' },
          { ...line, vat: { category: 'S', rate: '19,0' } },
        ],
        allowances: [{ amount: 'x', vat: { category: 'S', rate: 19 } }],
        prepaidAmount: '1,00',
      }),
    );
    const paths = v.map((x) => x.path).sort();
    expect(paths).toEqual(['allowances[0].amount', 'lines[0].quantity', 'lines[0].unit', 'lines[1].vat.rate', 'prepaidAmount'].sort());
  });

  it('priceBaseQuantity ≤ 0 → IF-NORM-011 (Division durch null)', () => {
    const line = base.lines[0]!;
    const v = violationsOf(() => normalize({ ...base, lines: [{ ...line, priceBaseQuantity: 0 }, { ...line, priceBaseQuantity: '-1' }] }));
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ rule: 'IF-NORM-011', path: 'lines[0].priceBaseQuantity', businessTerm: 'BT-149' });
    expect(v[1]).toMatchObject({ rule: 'IF-NORM-011', path: 'lines[1].priceBaseQuantity' });
    expect(v[0]!.message).toContain('0');
  });

  it('duplicate line IDs → IF-NORM-003', () => {
    const line = base.lines[0]!;
    const v = violationsOf(() => normalize({ ...base, lines: [{ ...line, id: '2' }, line] }));
    expect(v[0]).toMatchObject({ rule: 'IF-NORM-003', path: 'lines[1].id', businessTerm: 'BT-126' });
  });

  it('schema errors come through the same function as IF-SCHEMA-001', () => {
    const v = violationsOf(() => normalize({ ...base, lines: [] }));
    expect(v[0]).toMatchObject({ rule: 'IF-SCHEMA-001', path: 'lines' });
  });

  it('an unknown payment means is already caught by the schema (path payment.means)', () => {
    const v = violationsOf(() => normalize({ ...base, payment: { means: 'gold' as never } }));
    expect(v[0]!.path).toBe('payment.means');
  });
});

describe('normalize – payment terms (BT-20)', () => {
  it('appends the line break required by XRechnung after a trailing early payment discount line (BR-DE-18)', () => {
    const terms = (t: string): string | undefined => normalize({ ...base, payment: { means: 'transfer', terms: t } }).payment?.terms;
    expect(terms('Zahlbar in 30 Tagen.\n#SKONTO#TAGE=10#PROZENT=2.00#')).toBe('Zahlbar in 30 Tagen.\n#SKONTO#TAGE=10#PROZENT=2.00#\n');
    expect(terms('#SKONTO#TAGE=10#PROZENT=2.00#\n')).toBe('#SKONTO#TAGE=10#PROZENT=2.00#\n');
    expect(terms('#SKONTO#TAGE=10#PROZENT=2.00#\nDanke.')).toBe('#SKONTO#TAGE=10#PROZENT=2.00#\nDanke.');
    expect(terms('Zahlbar in 30 Tagen.')).toBe('Zahlbar in 30 Tagen.');
  });
});

describe('normalize – model extensions 1b', () => {
  it('passes through new party fields (id, tradingName, legalRegistration, orderReference)', () => {
    const n = normalize({
      ...base,
      seller: { ...base.seller, id: 'L-1', tradingName: 'Musterwerk', legalRegistration: { id: 'HRB 1', scheme: '0002' } },
      buyer: { ...base.buyer, orderReference: 'PO-7', legalRegistration: { id: 'HRB 2' } },
    });
    expect(n.seller.id).toBe('L-1');
    expect(n.seller.tradingName).toBe('Musterwerk');
    expect(n.seller.legalRegistration).toEqual({ id: 'HRB 1', scheme: '0002' });
    expect(n.buyer.orderReference).toBe('PO-7');
    expect(n.buyer.legalRegistration).toEqual({ id: 'HRB 2' });
    expect('orderReference' in n.seller).toBe(false);
  });

  it('normalizes deliveryDate to delivery.date and passes through the delivery address', () => {
    const address = { street: 'Lagerweg 3', city: 'Hamburg', postalCode: '20095', country: 'DE' };
    expect(normalize({ ...base, deliveryDate: '2026-09-01' }).delivery).toEqual({ date: '2026-09-01' });
    expect(normalize({ ...base, delivery: { date: '2026-09-02', address, recipientName: 'Lager' } }).delivery).toEqual({
      date: '2026-09-02',
      address,
      recipientName: 'Lager',
    });
    // Both set, same value: ok
    expect(normalize({ ...base, deliveryDate: '2026-09-01', delivery: { date: '2026-09-01' } }).delivery?.date).toBe('2026-09-01');
    expect(normalize(base).delivery).toBeUndefined();
    expect('deliveryDate' in normalize({ ...base, deliveryDate: '2026-09-01' })).toBe(false);
  });

  it('deliveryDate and delivery.date contradict each other → IF-NORM-004', () => {
    const v = violationsOf(() => normalize({ ...base, deliveryDate: '2026-09-01', delivery: { date: '2026-09-02' } }));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: 'IF-NORM-004', path: 'deliveryDate', businessTerm: 'BT-72' });
    expect(v[0]!.message).toContain('2026-09-01');
    expect(v[0]!.message).toContain('2026-09-02');
  });

  it('passes through precedingInvoices, direct debit fields and exemption reasons', () => {
    const n = normalize({
      ...base,
      type: 'correction',
      precedingInvoices: [{ number: 'RE-1', issueDate: '2026-01-01' }, { number: 'RE-2' }],
      payment: { means: 'sepa-direct-debit', mandateReference: 'M-1', creditorId: 'DE98ZZZ09999999999', debitedIban: 'DE89370400440532013000' },
      lines: [{ ...base.lines[0]!, vat: { category: 'E', rate: 0, exemptionReason: '§ 4 Nr. 14 UStG', exemptionReasonCode: 'VATEX-EU-132-1C' } }],
    });
    expect(n.precedingInvoices).toEqual([{ number: 'RE-1', issueDate: '2026-01-01' }, { number: 'RE-2' }]);
    expect(n.payment).toEqual({ meansCode: '59', mandateReference: 'M-1', creditorId: 'DE98ZZZ09999999999', debitedIban: 'DE89370400440532013000' });
    expect(n.lines[0]!.vat.exemptionReason).toBe('§ 4 Nr. 14 UStG');
    expect(n.lines[0]!.vat.exemptionReasonCode).toBe('VATEX-EU-132-1C');
    expect(normalize(base).precedingInvoices).toEqual([]);
  });

  it('sets the default exemption reason and VATEX code for AE, K, G, O (not for E, S, Z)', () => {
    const line = base.lines[0]!;
    const n = normalize({
      ...base,
      lines: (['AE', 'K', 'G', 'O', 'E', 'S', 'Z'] as const).map((category) => ({ ...line, vat: { category, rate: category === 'S' ? 19 : 0 } })),
      allowances: [{ amount: 1, reason: 'x', vat: { category: 'AE' } }],
    });
    expect(n.lines.map((l) => l.vat.exemptionReasonCode)).toEqual(['VATEX-EU-AE', 'VATEX-EU-IC', 'VATEX-EU-G', 'VATEX-EU-O', undefined, undefined, undefined]);
    expect(n.lines[0]!.vat.exemptionReason).toContain('Steuerschuldnerschaft des Leistungsempfängers');
    expect(n.lines[1]!.vat.exemptionReason).toContain('innergemeinschaftliche Lieferung');
    expect(n.allowances[0]!.vat.exemptionReasonCode).toBe('VATEX-EU-AE');
    // An explicit value takes precedence
    const own = normalize({ ...base, lines: [{ ...line, vat: { category: 'AE', exemptionReason: 'Reverse charge' } }] });
    expect(own.lines[0]!.vat.exemptionReason).toBe('Reverse charge');
    expect(own.lines[0]!.vat.exemptionReasonCode).toBe('VATEX-EU-AE');
  });
});
