/**
 * Internal, EN 16931-oriented model after normalization.
 *
 * - Codes instead of aliases (unit codes UN/ECE Rec. 20, payment means UNTDID 4461, type UNTDID 1001).
 * - Decimal instead of number/string.
 * - Defaults applied (profile, currency, line IDs, priceBaseQuantity, VAT rate 0 if not given).
 * - Still NO totals; those come exclusively from `calculate()`.
 */
import type { Decimal } from '../money/index.js';
import type { Profile, VatCategory } from './input.js';

export type InvoiceTypeCode = '380' | '381' | '384';

export interface NormalizedAddress {
  street: string;
  street2?: string;
  city: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
}

export interface NormalizedContact {
  name?: string;
  email?: string;
  phone?: string;
}

export interface NormalizedElectronicAddress {
  scheme: string;
  value: string;
}

export interface NormalizedLegalRegistration {
  /** BT-30 / BT-47 */
  id: string;
  /** BT-30-1 / BT-47-1, ISO 6523 ICD */
  scheme?: string;
}

export interface NormalizedParty {
  name: string;
  /** BT-29 / BT-46 */
  id?: string;
  /** BT-28 / BT-45 */
  tradingName?: string;
  /** BT-30 / BT-47 */
  legalRegistration?: NormalizedLegalRegistration;
  address: NormalizedAddress;
  /** BT-31 / BT-48 */
  vatId?: string;
  /** BT-32 */
  taxNumber?: string;
  contact?: NormalizedContact;
  electronicAddress?: NormalizedElectronicAddress;
}

export interface NormalizedBuyer extends NormalizedParty {
  /** BT-13 */
  orderReference?: string;
}

export interface NormalizedVat {
  category: VatCategory;
  /** Percentage (BT-152 / BT-119). 0 if not given. */
  rate: Decimal;
  /** BT-120, VAT exemption reason (text). Pre-filled with a default text for AE/K/G/O. */
  exemptionReason?: string;
  /** BT-121, VATEX code. Pre-filled for AE/K/G/O (VATEX-EU-AE, -IC, -G, -O). */
  exemptionReasonCode?: string;
}

export interface NormalizedDelivery {
  /** BT-72 */
  date?: string;
  /** BG-15 */
  address?: NormalizedAddress;
  /** BT-70 */
  recipientName?: string;
}

export interface NormalizedPrecedingInvoice {
  /** BT-25 */
  number: string;
  /** BT-26 */
  issueDate?: string;
}

/** Allowance/charge: either a fixed amount or a percentage (relative to the respective base). */
export type AllowanceChargeValue = { kind: 'amount'; amount: Decimal } | { kind: 'percent'; percent: Decimal };

export interface NormalizedLineAllowanceCharge {
  value: AllowanceChargeValue;
  reason?: string;
  reasonCode?: string;
}

export interface NormalizedDocumentAllowanceCharge extends NormalizedLineAllowanceCharge {
  vat: NormalizedVat;
}

export interface NormalizedLine {
  /** BT-126 */
  id: string;
  /** BT-153 */
  name: string;
  /** BT-154 */
  description?: string;
  /** BT-129 */
  quantity: Decimal;
  /** BT-130, UN/ECE Rec. 20 */
  unitCode: string;
  /** BT-146, net unit price, up to 4 decimal places */
  unitPrice: Decimal;
  /** BT-149, default 1 */
  priceBaseQuantity: Decimal;
  vat: NormalizedVat;
  allowances: NormalizedLineAllowanceCharge[];
  charges: NormalizedLineAllowanceCharge[];
}

export interface NormalizedPayment {
  /** BT-81, UNTDID 4461 */
  meansCode: string;
  iban?: string;
  bic?: string;
  accountHolder?: string;
  terms?: string;
  reference?: string;
  /** BT-89 */
  mandateReference?: string;
  /** BT-90 */
  creditorId?: string;
  /** BT-91 */
  debitedIban?: string;
}

export interface NormalizedInvoice {
  profile: Profile;
  /** BT-24 Specification identifier (Guideline-URN) */
  profileUrn: string;
  /** BT-1 */
  number: string;
  /** BT-3 */
  typeCode: InvoiceTypeCode;
  /** BT-2, ISO 8601 (YYYY-MM-DD) */
  issueDate: string;
  /** BT-9 */
  dueDate?: string;
  /** BT-5 */
  currency: string;
  /** BG-13, delivery (date BT-72, address BG-15, recipient BT-70) */
  delivery?: NormalizedDelivery;
  /** BT-73 */
  periodStart?: string;
  /** BT-74 */
  periodEnd?: string;
  /** BT-10 */
  buyerReference?: string;
  /** BT-22 */
  notes: string[];
  /** BG-3 */
  precedingInvoices: NormalizedPrecedingInvoice[];
  seller: NormalizedParty;
  buyer: NormalizedBuyer;
  payment?: NormalizedPayment;
  lines: NormalizedLine[];
  /** BG-20 */
  allowances: NormalizedDocumentAllowanceCharge[];
  /** BG-21 */
  charges: NormalizedDocumentAllowanceCharge[];
  /** BT-113 */
  prepaidAmount: Decimal;
  /** BT-114 */
  roundingAmount: Decimal;
}
