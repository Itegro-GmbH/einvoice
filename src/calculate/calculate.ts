/**
 * Calculation of all amounts per EN 16931, pure, deterministic, exclusively Decimal.
 *
 * Line (BG-25):
 *   gross      = quantity x unitPrice / priceBaseQuantity                     (unrounded)
 *   allowance  = amount | round2(gross x percent / 100)                        (BT-136, rounded per entry)
 *   charge     = amount | round2(gross x percent / 100)                        (BT-141, rounded per entry)
 *   BT-131     = round2(gross - sum(allowance) + sum(charge))
 *
 * Document level allowances/charges (BG-20/BG-21), the simpler variant we chose:
 *   Every allowance/charge names its VAT category and rate explicitly (mandatory in the input schema).
 *   Percentage allowances/charges apply to the sum of the line net amounts of the same
 *   (category, rate); there is NO proportional distribution across categories.
 *   Anyone who wants a discount "on everything" specifies it per category. This is EN 16931
 *   compliant (BT-93 basis amount, BT-94 percentage, BT-95/96 category/rate) and needs no
 *   rounding-distribution logic.
 *
 * VAT breakdown (BG-23) per (category, rate):
 *   BT-116 = sum(BT-131) (category, rate) - sum(document allowances) (category, rate) + sum(document charges) (category, rate)
 *   BT-117 = round2(BT-116 x rate / 100), on the total, never per line (BR-CO-17).
 *   Categories without VAT (Z, E, AE, K, G, O) have rate 0 (checked in 1b) and thus BT-117 = 0.
 *   L/M (Canary Islands, Ceuta/Melilla) may have a rate > 0; the formula is the same for all.
 *
 * Totals (BG-22):
 *   BT-106 = sum(BT-131)         BT-107 = sum(BT-92)       BT-108 = sum(BT-99)
 *   BT-109 = BT-106 - BT-107 + BT-108
 *   BT-110 = sum(BT-117)         BT-112 = BT-109 + BT-110
 *   BT-113 = prepaidAmount       BT-114 = roundingAmount   BT-115 = BT-112 - BT-113 + BT-114
 *
 * By construction, sum(BT-116) = BT-109 exactly (BR-S-08 and similar).
 */
import { HUNDRED, ZERO, round2, sum, type Decimal } from '../money/index.js';
import { VAT_CATEGORIES, type VatCategory } from '../model/input.js';
import type {
  CalculatedDocumentAllowanceCharge,
  CalculatedInvoice,
  CalculatedLine,
  CalculatedLineAllowanceCharge,
  InvoiceTotals,
  VatBreakdownEntry,
} from '../model/calculated.js';
import type {
  AllowanceChargeValue,
  NormalizedDocumentAllowanceCharge,
  NormalizedInvoice,
  NormalizedLine,
  NormalizedLineAllowanceCharge,
} from '../model/normalized.js';

export type { CalculatedInvoice } from '../model/calculated.js';

function resolveAmount(value: AllowanceChargeValue, base: Decimal): Decimal {
  return value.kind === 'amount' ? round2(value.amount) : round2(base.times(value.percent).div(HUNDRED));
}

function calculateLineAllowanceCharge(ac: NormalizedLineAllowanceCharge, gross: Decimal): CalculatedLineAllowanceCharge {
  return { ...ac, amount: resolveAmount(ac.value, gross) };
}

function calculateLine(line: NormalizedLine): CalculatedLine {
  if (!line.priceBaseQuantity.gt(0)) {
    // Prevented by normalize() (IF-NORM-011); this is only a safety net against NaN/Infinity.
    throw new RangeError(`priceBaseQuantity of line ${line.id} must be > 0.`);
  }
  const gross = line.quantity.times(line.unitPrice).div(line.priceBaseQuantity);
  const allowances = line.allowances.map((ac) => calculateLineAllowanceCharge(ac, gross));
  const charges = line.charges.map((ac) => calculateLineAllowanceCharge(ac, gross));
  const net = round2(gross.minus(sum(allowances.map((a) => a.amount))).plus(sum(charges.map((c) => c.amount))));
  return { ...line, allowances, charges, grossAmount: gross, netAmount: net };
}

/** Key for grouping by (category, rate). Decimal.toString() is canonical ("19" == "19.0"). */
function groupKey(category: VatCategory, rate: Decimal): string {
  return `${category}|${rate.toString()}`;
}

interface Group {
  category: VatCategory;
  rate: Decimal;
  lineNet: Decimal;
  allowances: Decimal;
  charges: Decimal;
}

class Groups {
  private readonly map = new Map<string, Group>();

  get(category: VatCategory, rate: Decimal): Group {
    const key = groupKey(category, rate);
    let g = this.map.get(key);
    if (g === undefined) {
      g = { category, rate, lineNet: ZERO, allowances: ZERO, charges: ZERO };
      this.map.set(key, g);
    }
    return g;
  }

  /** Fixed order: category in code-list order (S, Z, E, AE, K, G, O, L, M), then rate ascending. */
  sorted(): Group[] {
    const order = new Map<VatCategory, number>(VAT_CATEGORIES.map((c, i) => [c, i]));
    return [...this.map.values()].sort((a, b) => {
      const byCategory = (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0);
      return byCategory !== 0 ? byCategory : a.rate.comparedTo(b.rate);
    });
  }
}

function calculateDocumentAllowanceCharge(ac: NormalizedDocumentAllowanceCharge, base: Decimal): CalculatedDocumentAllowanceCharge {
  return { ...ac, amount: resolveAmount(ac.value, base), baseAmount: base };
}

export function calculate(invoice: NormalizedInvoice): CalculatedInvoice {
  const lines = invoice.lines.map(calculateLine);

  const groups = new Groups();
  for (const line of lines) {
    const g = groups.get(line.vat.category, line.vat.rate);
    g.lineNet = g.lineNet.plus(line.netAmount);
  }

  // Base for percentage document level allowances/charges: line net sum of the same (category, rate).
  const allowances = invoice.allowances.map((ac) =>
    calculateDocumentAllowanceCharge(ac, groups.get(ac.vat.category, ac.vat.rate).lineNet),
  );
  const charges = invoice.charges.map((ac) =>
    calculateDocumentAllowanceCharge(ac, groups.get(ac.vat.category, ac.vat.rate).lineNet),
  );
  for (const ac of allowances) {
    const g = groups.get(ac.vat.category, ac.vat.rate);
    g.allowances = g.allowances.plus(ac.amount);
  }
  for (const ac of charges) {
    const g = groups.get(ac.vat.category, ac.vat.rate);
    g.charges = g.charges.plus(ac.amount);
  }

  const vatBreakdown: VatBreakdownEntry[] = groups.sorted().map((g) => {
    const taxableAmount = g.lineNet.minus(g.allowances).plus(g.charges);
    const taxAmount = round2(taxableAmount.times(g.rate).div(HUNDRED));
    return { category: g.category, rate: g.rate, taxableAmount, taxAmount };
  });

  const lineTotal = sum(lines.map((l) => l.netAmount));
  const allowanceTotal = sum(allowances.map((a) => a.amount));
  const chargeTotal = sum(charges.map((c) => c.amount));
  const taxExclusiveAmount = lineTotal.minus(allowanceTotal).plus(chargeTotal);
  const taxTotal = sum(vatBreakdown.map((b) => b.taxAmount));
  const taxInclusiveAmount = taxExclusiveAmount.plus(taxTotal);
  const prepaidAmount = round2(invoice.prepaidAmount);
  const roundingAmount = round2(invoice.roundingAmount);
  const payableAmount = taxInclusiveAmount.minus(prepaidAmount).plus(roundingAmount);

  const totals: InvoiceTotals = {
    lineTotal,
    allowanceTotal,
    chargeTotal,
    taxExclusiveAmount,
    taxTotal,
    taxInclusiveAmount,
    prepaidAmount,
    roundingAmount,
    payableAmount,
  };

  return { ...invoice, lines, allowances, charges, vatBreakdown, totals };
}
