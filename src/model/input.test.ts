import { describe, expect, it } from 'vitest';
import { InvoiceError } from '../errors/index.js';
import { InvoiceInputSchema, parseInvoiceInput, type InvoiceInput } from './input.js';

const minimal: InvoiceInput = {
  number: 'RE-1',
  issueDate: '2026-09-12',
  seller: { name: 'A', address: { street: 'S 1', city: 'X', postalCode: '1', country: 'DE' } },
  buyer: { name: 'B', address: { street: 'S 2', city: 'Y', postalCode: '2', country: 'DE' } },
  lines: [{ name: 'Ding', quantity: 1, unit: 'Stück', unitPrice: 10, vat: { category: 'S', rate: 19 } }],
};

describe('InvoiceInputSchema – defaults', () => {
  it('sets profile=en16931, currency=EUR, type=380', () => {
    const parsed = InvoiceInputSchema.parse(minimal);
    expect(parsed.profile).toBe('en16931');
    expect(parsed.currency).toBe('EUR');
    expect(parsed.type).toBe('380');
  });

  it('keeps explicit values', () => {
    const parsed = InvoiceInputSchema.parse({ ...minimal, profile: 'xrechnung', currency: 'CHF', type: '381' });
    expect(parsed.profile).toBe('xrechnung');
    expect(parsed.currency).toBe('CHF');
    expect(parsed.type).toBe('381');
  });

  it('accepts type aliases', () => {
    expect(InvoiceInputSchema.parse({ ...minimal, type: 'credit-note' }).type).toBe('credit-note');
  });
});

describe('InvoiceInputSchema – structure', () => {
  it('requires at least one line', () => {
    const r = InvoiceInputSchema.safeParse({ ...minimal, lines: [] });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid date', () => {
    expect(InvoiceInputSchema.safeParse({ ...minimal, issueDate: '12.09.2026' }).success).toBe(false);
    expect(InvoiceInputSchema.safeParse({ ...minimal, issueDate: '2026-02-30' }).success).toBe(false);
    expect(InvoiceInputSchema.safeParse({ ...minimal, issueDate: '2026-09-12' }).success).toBe(true);
  });

  it('requires ISO 3166 alpha-2 countries and an ISO 4217 currency', () => {
    const bad = { ...minimal, seller: { ...minimal.seller, address: { ...minimal.seller.address, country: 'Deutschland' } } };
    expect(InvoiceInputSchema.safeParse(bad).success).toBe(false);
    expect(InvoiceInputSchema.safeParse({ ...minimal, currency: 'Euro' }).success).toBe(false);
    expect(InvoiceInputSchema.safeParse({ ...minimal, currency: 'eur' }).success).toBe(false);
  });

  it('allows amounts as number or string', () => {
    const ok = { ...minimal, lines: [{ ...minimal.lines[0]!, unitPrice: '10.50', quantity: '2' }] };
    expect(InvoiceInputSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects unknown VAT categories', () => {
    const bad = { ...minimal, lines: [{ ...minimal.lines[0]!, vat: { category: 'X' } }] };
    expect(InvoiceInputSchema.safeParse(bad).success).toBe(false);
  });

  it('Allowance/Charge: exactly one of amount/percent', () => {
    const line = minimal.lines[0]!;
    expect(InvoiceInputSchema.safeParse({ ...minimal, lines: [{ ...line, allowances: [{ amount: 1 }] }] }).success).toBe(true);
    expect(InvoiceInputSchema.safeParse({ ...minimal, lines: [{ ...line, allowances: [{ percent: 10 }] }] }).success).toBe(true);
    expect(InvoiceInputSchema.safeParse({ ...minimal, lines: [{ ...line, allowances: [{ amount: 1, percent: 10 }] }] }).success).toBe(false);
    expect(InvoiceInputSchema.safeParse({ ...minimal, lines: [{ ...line, allowances: [{ reason: 'x' }] }] }).success).toBe(false);
  });

  it('document allowance requires vat', () => {
    expect(InvoiceInputSchema.safeParse({ ...minimal, allowances: [{ amount: 5 }] }).success).toBe(false);
    expect(InvoiceInputSchema.safeParse({ ...minimal, allowances: [{ amount: 5, vat: { category: 'S', rate: 19 } }] }).success).toBe(true);
  });

  it('payment means accepts codes and aliases', () => {
    expect(InvoiceInputSchema.safeParse({ ...minimal, payment: { means: 'transfer' } }).success).toBe(true);
    expect(InvoiceInputSchema.safeParse({ ...minimal, payment: { means: '58' } }).success).toBe(true);
    expect(InvoiceInputSchema.safeParse({ ...minimal, payment: { means: 'bitcoin' } }).success).toBe(false);
  });

  it('rejects unknown fields (typos should stand out)', () => {
    expect(InvoiceInputSchema.safeParse({ ...minimal, numer: 'x' }).success).toBe(false);
  });

  it('contact email is validated', () => {
    const bad = { ...minimal, seller: { ...minimal.seller, contact: { email: 'keine-mail' } } };
    expect(InvoiceInputSchema.safeParse(bad).success).toBe(false);
  });
});

describe('parseInvoiceInput', () => {
  it('returns an InvoiceError with a path in input notation on schema errors', () => {
    const bad = { ...minimal, lines: [{ ...minimal.lines[0]!, vat: { category: 'X' } }, { name: 'ohne alles' }] };
    let caught: unknown;
    try {
      parseInvoiceInput(bad);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvoiceError);
    const err = caught as InvoiceError;
    const paths = err.violations.map((v) => v.path);
    expect(paths).toContain('lines[0].vat.category');
    expect(paths).toContain('lines[1].quantity');
    expect(err.violations.every((v) => v.rule === 'IF-SCHEMA-001')).toBe(true);
  });

  it('returns the parsed object with defaults for valid input', () => {
    expect(parseInvoiceInput(minimal).currency).toBe('EUR');
  });
});

describe('InvoiceInputSchema – extensions 1b', () => {
  it('accepts exemption reason and VATEX code on line and document tax', () => {
    const line = { ...minimal.lines[0]!, vat: { category: 'AE', rate: 0, exemptionReason: 'Reverse Charge', exemptionReasonCode: 'VATEX-EU-AE' } };
    const ok = { ...minimal, lines: [line], allowances: [{ amount: 1, reason: 'Rabatt', vat: { category: 'AE', exemptionReasonCode: 'VATEX-EU-AE' } }] };
    expect(InvoiceInputSchema.safeParse(ok).success).toBe(true);
  });

  it('accepts direct debit fields (mandateReference, creditorId, debitedIban)', () => {
    const ok = { ...minimal, payment: { means: 'sepa-direct-debit', mandateReference: 'M-1', creditorId: 'DE98ZZZ09999999999', debitedIban: 'DE89370400440532013000' } };
    expect(InvoiceInputSchema.safeParse(ok).success).toBe(true);
  });

  it('accepts precedingInvoices with number and optional issueDate', () => {
    expect(InvoiceInputSchema.safeParse({ ...minimal, precedingInvoices: [{ number: 'RE-0' }, { number: 'RE-00', issueDate: '2026-01-01' }] }).success).toBe(true);
    expect(InvoiceInputSchema.safeParse({ ...minimal, precedingInvoices: [{ issueDate: '2026-01-01' }] }).success).toBe(false);
    expect(InvoiceInputSchema.safeParse({ ...minimal, precedingInvoices: [{ number: 'RE-0', issueDate: '01.01.2026' }] }).success).toBe(false);
  });

  it('accepts buyer.orderReference, seller.legalRegistration, seller.tradingName, party.id', () => {
    const ok = {
      ...minimal,
      seller: { ...minimal.seller, id: 'L-42', legalRegistration: { id: 'HRB 12345', scheme: '0002' }, tradingName: 'Musterwerk' },
      buyer: { ...minimal.buyer, orderReference: 'PO-2026-1' },
    };
    expect(InvoiceInputSchema.safeParse(ok).success).toBe(true);
    expect(InvoiceInputSchema.safeParse({ ...minimal, seller: { ...minimal.seller, legalRegistration: { scheme: '0002' } } }).success).toBe(false);
    // orderReference is a buyer property (BT-13); a typo on the seller
    expect(InvoiceInputSchema.safeParse({ ...minimal, seller: { ...minimal.seller, orderReference: 'x' } }).success).toBe(false);
  });

  it('accepts delivery {date, address, recipientName} and still accepts deliveryDate as an alias', () => {
    const address = { street: 'Lagerweg 3', city: 'Hamburg', postalCode: '20095', country: 'DE' };
    expect(InvoiceInputSchema.safeParse({ ...minimal, delivery: { date: '2026-09-01', address, recipientName: 'Lager Nord' } }).success).toBe(true);
    expect(InvoiceInputSchema.safeParse({ ...minimal, delivery: {} }).success).toBe(true);
    expect(InvoiceInputSchema.safeParse({ ...minimal, deliveryDate: '2026-09-01' }).success).toBe(true);
    expect(InvoiceInputSchema.safeParse({ ...minimal, delivery: { address: { city: 'Hamburg' } } }).success).toBe(false);
  });
});
