/**
 * Public input model of @itegro/einvoice.
 *
 * This is the plain-JSON object that `generate()` and `generateXml()` accept. Deliberately phrased in
 * human terms (`buyer.vatId`, `lines[].unit: "piece"`); the mapping to EN 16931 code lists
 * happens during normalization, not here.
 *
 * Only the *structure* is checked here (Zod). Business rules (category S needs rate > 0,
 * reverse charge needs the buyer's VAT identifier, ...) are the responsibility of semantic
 * validation (`validate()`).
 */
import { z } from 'zod';
import { InvoiceError, formatPath, type Violation } from '../errors/index.js';

/** Amounts and quantities: number or string (dot as the decimal separator). Parsed during normalization. */
export const AmountInputSchema = z.union([z.number(), z.string()]);
export type AmountInput = z.input<typeof AmountInputSchema>;

export const PROFILES = ['basic', 'en16931', 'extended', 'xrechnung'] as const;
export const ProfileSchema = z.enum(PROFILES);
export type Profile = z.infer<typeof ProfileSchema>;

/** UNTDID 1001, invoice types we support, plus human-readable aliases. */
export const INVOICE_TYPE_CODES = ['380', '381', '384'] as const;
export const INVOICE_TYPE_ALIASES = ['invoice', 'credit-note', 'correction'] as const;
export const InvoiceTypeSchema = z.enum([...INVOICE_TYPE_CODES, ...INVOICE_TYPE_ALIASES]);
export type InvoiceTypeInput = z.infer<typeof InvoiceTypeSchema>;

/** UNTDID 5305, VAT categories. */
export const VAT_CATEGORIES = ['S', 'Z', 'E', 'AE', 'K', 'G', 'O', 'L', 'M'] as const;
export const VatCategorySchema = z.enum(VAT_CATEGORIES);
export type VatCategory = z.infer<typeof VatCategorySchema>;

/** UNTDID 4461, payment means (codes) plus human-readable aliases. */
export const PAYMENT_MEANS_CODES = ['1', '10', '20', '30', '42', '48', '49', '57', '58', '59', '68', '97', 'ZZZ'] as const;
export const PAYMENT_MEANS_ALIASES = ['transfer', 'sepa-direct-debit', 'card', 'cash'] as const;
export const PaymentMeansSchema = z.enum([...PAYMENT_MEANS_CODES, ...PAYMENT_MEANS_ALIASES]);
export type PaymentMeansInput = z.infer<typeof PaymentMeansSchema>;

const nonEmpty = z.string().trim().min(1);
const isoDate = z.iso.date();
const countryCode = z.string().regex(/^[A-Z]{2}$/, 'Expected an ISO 3166-1 alpha-2 country code, e.g. "DE"');
const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 currency code, e.g. "EUR"');

export const AddressSchema = z.strictObject({
  street: nonEmpty,
  street2: nonEmpty.optional(),
  city: nonEmpty,
  postalCode: nonEmpty,
  country: countryCode,
});

export const ContactSchema = z.strictObject({
  name: nonEmpty.optional(),
  email: z.email().optional(),
  phone: nonEmpty.optional(),
});

export const ElectronicAddressSchema = z.strictObject({
  /** Scheme ID per the EAS code list, e.g. "EM" (email), "0204" (Leitweg-ID), "9930" (DE VAT identifier). */
  scheme: nonEmpty,
  value: nonEmpty,
});

/** Legal registration entry (BT-30 seller / BT-47 buyer), e.g. a trade register number; `scheme` per ISO 6523 ICD (e.g. "0002"). */
export const LegalRegistrationSchema = z.strictObject({
  id: nonEmpty,
  scheme: nonEmpty.optional(),
});

const partyBase = {
  name: nonEmpty,
  /** The party's own identifier (BT-29 seller / BT-46 buyer), e.g. a supplier or customer number. */
  id: nonEmpty.optional(),
  /** Trading name, if different from the name (BT-28 / BT-45). */
  tradingName: nonEmpty.optional(),
  /** Legal registration entry (BT-30 / BT-47). */
  legalRegistration: LegalRegistrationSchema.optional(),
  address: AddressSchema,
  /** VAT identifier (BT-31 / BT-48). */
  vatId: nonEmpty.optional(),
  /** Tax number (BT-32; seller only). */
  taxNumber: nonEmpty.optional(),
  contact: ContactSchema.optional(),
  electronicAddress: ElectronicAddressSchema.optional(),
};

export const SellerSchema = z.strictObject(partyBase);

export const BuyerSchema = z.strictObject({
  ...partyBase,
  /** Buyer's order reference (BT-13). */
  orderReference: nonEmpty.optional(),
});

/** @deprecated Use `SellerSchema` / `BuyerSchema`. Kept as an alias for the seller structure. */
export const PartySchema = SellerSchema;

export const VatSchema = z.strictObject({
  category: VatCategorySchema,
  rate: AmountInputSchema.optional(),
  /** VAT exemption reason as text (BT-120), e.g. "Intra-community supply exempt from VAT". */
  exemptionReason: nonEmpty.optional(),
  /** VAT exemption reason as a VATEX code (BT-121), e.g. "VATEX-EU-IC". */
  exemptionReasonCode: nonEmpty.optional(),
});

/** Delivery (BG-13): delivery date (BT-72), delivery address (BG-15), recipient name (BT-70). */
export const DeliverySchema = z.strictObject({
  date: isoDate.optional(),
  address: AddressSchema.optional(),
  recipientName: nonEmpty.optional(),
});

/** Preceding invoice (BG-3): number (BT-25), date (BT-26). */
export const PrecedingInvoiceSchema = z.strictObject({
  number: nonEmpty,
  issueDate: isoDate.optional(),
});

const allowanceChargeBase = {
  amount: AmountInputSchema.optional(),
  percent: AmountInputSchema.optional(),
  reason: nonEmpty.optional(),
  /** UNTDID 5189 (allowances) resp. UNTDID 7161 (charges). */
  reasonCode: nonEmpty.optional(),
};

const exactlyOneOfAmountPercent = (v: { amount?: unknown; percent?: unknown }, ctx: z.RefinementCtx): void => {
  const has = (v.amount !== undefined ? 1 : 0) + (v.percent !== undefined ? 1 : 0);
  if (has !== 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'Exactly one of "amount" or "percent" must be given.',
      path: has === 0 ? ['amount'] : ['percent'],
    });
  }
};

export const LineAllowanceChargeSchema = z.strictObject(allowanceChargeBase).superRefine(exactlyOneOfAmountPercent);

export const DocumentAllowanceChargeSchema = z
  .strictObject({
    ...allowanceChargeBase,
    /** Mandatory: document level allowances/charges belong to exactly one VAT category (BG-20/BG-21). */
    vat: VatSchema,
  })
  .superRefine(exactlyOneOfAmountPercent);

export const LineSchema = z.strictObject({
  /** Line ID (BT-126). Default: sequential starting at 1. */
  id: nonEmpty.optional(),
  name: nonEmpty,
  description: nonEmpty.optional(),
  /** Quantity (BT-129). Negative allowed (cancellation/credit), 0 makes no sense; checked in 1b. */
  quantity: AmountInputSchema,
  /** Unit: alias ("piece", "hour") or a UN/ECE Rec. 20 code ("C62", "HUR"). */
  unit: nonEmpty,
  /** Item net price (BT-146), up to 4 decimal places. */
  unitPrice: AmountInputSchema,
  /** Item price base quantity (BT-149). Default 1. */
  priceBaseQuantity: AmountInputSchema.optional(),
  vat: VatSchema,
  allowances: z.array(LineAllowanceChargeSchema).optional(),
  charges: z.array(LineAllowanceChargeSchema).optional(),
});

export const PaymentSchema = z.strictObject({
  means: PaymentMeansSchema,
  /** Seller IBAN (BT-84) for a credit transfer. */
  iban: nonEmpty.optional(),
  /** BIC (BT-86). */
  bic: nonEmpty.optional(),
  /** Account holder (BT-85). */
  accountHolder: nonEmpty.optional(),
  /** Payment terms as text (BT-20). */
  terms: nonEmpty.optional(),
  /** Remittance information (BT-83). */
  reference: nonEmpty.optional(),
  /** SEPA mandate reference (BT-89) for direct debit. */
  mandateReference: nonEmpty.optional(),
  /** Creditor identifier (BT-90) for direct debit. */
  creditorId: nonEmpty.optional(),
  /** Buyer IBAN (BT-91) debited for direct debit. */
  debitedIban: nonEmpty.optional(),
});

export const InvoiceInputSchema = z.strictObject({
  profile: ProfileSchema.default('en16931'),
  number: nonEmpty,
  issueDate: isoDate,
  dueDate: isoDate.optional(),
  currency: currencyCode.default('EUR'),
  type: InvoiceTypeSchema.default('380'),
  /** Delivery date (BT-72), an alias for `delivery.date`, normalized into it. */
  deliveryDate: isoDate.optional(),
  delivery: DeliverySchema.optional(),
  periodStart: isoDate.optional(),
  periodEnd: isoDate.optional(),
  /** Buyer reference (BT-10), mandatory for XRechnung (Leitweg-ID). */
  buyerReference: nonEmpty.optional(),
  notes: z.array(nonEmpty).optional(),
  /** Preceding invoices (BG-3), expected for corrective invoices (384). */
  precedingInvoices: z.array(PrecedingInvoiceSchema).optional(),
  seller: SellerSchema,
  buyer: BuyerSchema,
  payment: PaymentSchema.optional(),
  lines: z.array(LineSchema).min(1, 'At least one invoice line is required.'),
  allowances: z.array(DocumentAllowanceChargeSchema).optional(),
  charges: z.array(DocumentAllowanceChargeSchema).optional(),
  /** Amount already paid (BT-113). */
  prepaidAmount: AmountInputSchema.optional(),
  /** Rounding amount (BT-114). */
  roundingAmount: AmountInputSchema.optional(),
});

/** What the caller sends (defaults optional). */
export type InvoiceInput = z.input<typeof InvoiceInputSchema>;
/** What is present after the Zod parse (defaults applied). */
export type ParsedInvoiceInput = z.output<typeof InvoiceInputSchema>;

export type PartyInput = z.input<typeof SellerSchema>;
export type SellerInput = z.input<typeof SellerSchema>;
export type BuyerInput = z.input<typeof BuyerSchema>;
export type DeliveryInput = z.input<typeof DeliverySchema>;
export type PrecedingInvoiceInput = z.input<typeof PrecedingInvoiceSchema>;
export type LineInput = z.input<typeof LineSchema>;
export type VatInput = z.input<typeof VatSchema>;
export type PaymentInput = z.input<typeof PaymentSchema>;
export type LineAllowanceChargeInput = z.input<typeof LineAllowanceChargeSchema>;
export type DocumentAllowanceChargeInput = z.input<typeof DocumentAllowanceChargeSchema>;

/**
 * Parses an unknown input against the schema. Schema errors are thrown as `InvoiceError`
 * with rule `IF-SCHEMA-001` and the path in input notation.
 */
export function parseInvoiceInput(input: unknown): ParsedInvoiceInput {
  const result = InvoiceInputSchema.safeParse(input);
  if (result.success) return result.data;
  const violations: Violation[] = result.error.issues.map((issue) => ({
    rule: 'IF-SCHEMA-001',
    path: formatPath(issue.path),
    message: issue.message,
  }));
  throw new InvoiceError(violations);
}
