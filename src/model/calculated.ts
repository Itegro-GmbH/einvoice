/**
 * Result of `calculate()`: the normalized model plus every amount we compute ourselves.
 * All amounts are Decimal with at most 2 decimal places (unit prices stay at up to 4).
 */
import type { Decimal } from '../money/index.js';
import type { VatCategory } from './input.js';
import type {
  NormalizedDocumentAllowanceCharge,
  NormalizedInvoice,
  NormalizedLine,
  NormalizedLineAllowanceCharge,
} from './normalized.js';

export interface CalculatedLineAllowanceCharge extends NormalizedLineAllowanceCharge {
  /** BT-136 / BT-141, resolved amount, 2 decimal places. */
  amount: Decimal;
}

export interface CalculatedDocumentAllowanceCharge extends NormalizedDocumentAllowanceCharge {
  /** BT-92 / BT-99, resolved amount, 2 decimal places. */
  amount: Decimal;
  /** BT-93 / BT-100, base for percentage allowances/charges (sum of lines of this category/rate). */
  baseAmount: Decimal;
}

export interface CalculatedLine extends Omit<NormalizedLine, 'allowances' | 'charges'> {
  allowances: CalculatedLineAllowanceCharge[];
  charges: CalculatedLineAllowanceCharge[];
  /** quantity x unitPrice / priceBaseQuantity, unrounded (basis for BT-137/BT-142). */
  grossAmount: Decimal;
  /** BT-131, line net amount, 2 decimal places. */
  netAmount: Decimal;
}

/** BG-23, VAT breakdown per (category, rate). */
export interface VatBreakdownEntry {
  /** BT-118 */
  category: VatCategory;
  /** BT-119 */
  rate: Decimal;
  /** BT-116 */
  taxableAmount: Decimal;
  /** BT-117 */
  taxAmount: Decimal;
}

export interface InvoiceTotals {
  /** BT-106, sum of all line net amounts */
  lineTotal: Decimal;
  /** BT-107, sum of document level allowances */
  allowanceTotal: Decimal;
  /** BT-108, sum of document level charges */
  chargeTotal: Decimal;
  /** BT-109, total invoice amount without VAT */
  taxExclusiveAmount: Decimal;
  /** BT-110, total VAT amount */
  taxTotal: Decimal;
  /** BT-112, total invoice amount with VAT */
  taxInclusiveAmount: Decimal;
  /** BT-113, amount already paid */
  prepaidAmount: Decimal;
  /** BT-114, rounding amount */
  roundingAmount: Decimal;
  /** BT-115, amount due for payment */
  payableAmount: Decimal;
}

export interface CalculatedInvoice extends Omit<NormalizedInvoice, 'lines' | 'allowances' | 'charges'> {
  lines: CalculatedLine[];
  allowances: CalculatedDocumentAllowanceCharge[];
  charges: CalculatedDocumentAllowanceCharge[];
  vatBreakdown: VatBreakdownEntry[];
  totals: InvoiceTotals;
}
