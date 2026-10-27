/**
 * fast-check generators for invoices, shared between the property tests of the calculation logic
 * (`src/calculate/calculate.property.test.ts`) and the serialization/Schematron property test (`test/property/`).
 */
import fc from 'fast-check';
import type { InvoiceInput, VatCategory } from '../src/index.js';
import { D, type Decimal } from '../src/money/index.js';
import type {
  AllowanceChargeValue,
  NormalizedDocumentAllowanceCharge,
  NormalizedInvoice,
  NormalizedLine,
  NormalizedLineAllowanceCharge,
  NormalizedVat,
} from '../src/model/normalized.js';

/** Decimal with exactly `places` decimal places (scale) in the range [min, max]. */
export function scaledDecimalArb(min: number, max: number, places: number): fc.Arbitrary<Decimal> {
  const scale = 10 ** places;
  return fc.integer({ min: Math.ceil(min * scale), max: Math.floor(max * scale) }).map((scaled) => D(scaled).div(scale));
}

/** Decimal with up to `places` decimal places: a mix of round, 2-digit and full-precision values. */
export function decimalArb(min: number, max: number, places: number): fc.Arbitrary<Decimal> {
  const variants = new Set([0, Math.min(2, places), places]);
  return fc.oneof(...[...variants].map((p) => scaledDecimalArb(min, max, p)));
}

export const RATES = ['0', '5.5', '7', '19', '20', '21'] as const;
export const CATEGORIES: readonly VatCategory[] = ['S', 'Z', 'E', 'AE', 'K'];

export const vatArb: fc.Arbitrary<NormalizedVat> = fc.record({
  category: fc.constantFrom(...CATEGORIES),
  rate: fc.constantFrom(...RATES).map(D),
});

/** Category S only with rate > 0: business-valid without exemption reasons/VAT ID conditions. */
export const standardVatArb: fc.Arbitrary<NormalizedVat> = fc.record({
  category: fc.constant<VatCategory>('S'),
  rate: fc.constantFrom('5.5', '7', '19', '20', '21').map(D),
});

export const allowanceChargeValueArb: fc.Arbitrary<AllowanceChargeValue> = fc.oneof(
  decimalArb(0, 100, 2).map((amount) => ({ kind: 'amount', amount }) as const),
  decimalArb(0, 100, 2).map((percent) => ({ kind: 'percent', percent }) as const),
);

const lineAllowanceChargeArb: fc.Arbitrary<NormalizedLineAllowanceCharge> = allowanceChargeValueArb.map((value) => ({ value, reason: 'Grund' }));

function lineArbWith(vat: fc.Arbitrary<NormalizedVat>): fc.Arbitrary<Omit<NormalizedLine, 'id'>> {
  return fc.record({
    name: fc.constant('Position'),
    quantity: decimalArb(-1000, 1000, 4),
    unitCode: fc.constant('C62'),
    unitPrice: decimalArb(0, 10000, 4),
    priceBaseQuantity: fc.oneof(fc.constant(D(1)), fc.constant(D(1)), fc.constantFrom(D(10), D(100), D(1000)), decimalArb(0.01, 100, 2)),
    vat,
    allowances: fc.array(lineAllowanceChargeArb, { maxLength: 3 }),
    charges: fc.array(lineAllowanceChargeArb, { maxLength: 3 }),
  });
}

function documentAllowanceChargeArbWith(vat: fc.Arbitrary<NormalizedVat>): fc.Arbitrary<NormalizedDocumentAllowanceCharge> {
  return fc.record({ value: allowanceChargeValueArb, vat, reason: fc.constant('Grund') });
}

function invoiceArbWith(vat: fc.Arbitrary<NormalizedVat>, maxLines: number): fc.Arbitrary<NormalizedInvoice> {
  return fc
    .record({
      lines: fc.array(lineArbWith(vat), { minLength: 1, maxLength: maxLines }),
      allowances: fc.array(documentAllowanceChargeArbWith(vat), { maxLength: 4 }),
      charges: fc.array(documentAllowanceChargeArbWith(vat), { maxLength: 4 }),
      prepaidAmount: decimalArb(-10000, 10000, 2),
      roundingAmount: decimalArb(-1, 1, 2),
    })
    .map(({ lines, allowances, charges, prepaidAmount, roundingAmount }) => ({
      profile: 'en16931',
      profileUrn: 'urn:cen.eu:en16931:2017',
      number: 'PROP-1',
      typeCode: '380',
      issueDate: '2026-09-12',
      currency: 'EUR',
      notes: [],
      precedingInvoices: [],
      seller: { name: 'S', address: { street: 's', city: 'c', postalCode: '1', country: 'DE' }, vatId: 'DE123456789' },
      buyer: { name: 'B', address: { street: 's', city: 'c', postalCode: '1', country: 'DE' } },
      lines: lines.map((l, i) => ({ ...l, id: String(i + 1) })),
      allowances,
      charges,
      prepaidAmount,
      roundingAmount,
    }));
}

/** Normalized invoice with mixed categories (S, Z, E, AE, K), for the calculation logic. */
export const invoiceArb: fc.Arbitrary<NormalizedInvoice> = invoiceArbWith(vatArb, 50);

/** Normalized invoice with category S only (rate > 0): business-valid, for serialization + Schematron. */
export const standardInvoiceArb: fc.Arbitrary<NormalizedInvoice> = invoiceArbWith(standardVatArb, 12);

/** Maps a normalized invoice to the public input format (Decimal → string). */
export function toInvoiceInput(inv: NormalizedInvoice): InvoiceInput {
  const value = (v: AllowanceChargeValue): { amount?: string; percent?: string } =>
    v.kind === 'amount' ? { amount: v.amount.toString() } : { percent: v.percent.toString() };
  return {
    profile: inv.profile,
    number: inv.number,
    issueDate: inv.issueDate,
    deliveryDate: inv.issueDate,
    currency: inv.currency,
    type: inv.typeCode,
    seller: inv.seller,
    buyer: inv.buyer,
    payment: { means: 'transfer', iban: 'DE89370400440532013000' },
    lines: inv.lines.map((l) => ({
      id: l.id,
      name: l.name,
      quantity: l.quantity.toString(),
      unit: l.unitCode,
      unitPrice: l.unitPrice.toString(),
      priceBaseQuantity: l.priceBaseQuantity.toString(),
      vat: { category: l.vat.category, rate: l.vat.rate.toString() },
      allowances: l.allowances.map((a) => ({ ...value(a.value), reason: a.reason ?? 'Grund' })),
      charges: l.charges.map((c) => ({ ...value(c.value), reason: c.reason ?? 'Grund' })),
    })),
    allowances: inv.allowances.map((a) => ({ ...value(a.value), reason: a.reason ?? 'Grund', vat: { category: a.vat.category, rate: a.vat.rate.toString() } })),
    charges: inv.charges.map((c) => ({ ...value(c.value), reason: c.reason ?? 'Grund', vat: { category: c.vat.category, rate: c.vat.rate.toString() } })),
    prepaidAmount: inv.prepaidAmount.toString(),
    roundingAmount: inv.roundingAmount.toString(),
  };
}

/** Public input that passes `validate()` without a violation (category S only). */
export const validInvoiceInputArb: fc.Arbitrary<InvoiceInput> = standardInvoiceArb.map(toInvoiceInput);
