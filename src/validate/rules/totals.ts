/**
 * Totals consistency BR-CO-10 … BR-CO-16 (BG-22). `calculate()` guarantees them by construction;
 * these rules are the safety net against later changes to the calculated object.
 * BR-CO-17 (tax amount per breakdown group) lives with the category rules.
 */
import type { CalculatedInvoice } from '../../model/calculated.js';
import { sum, type Decimal } from '../../money/index.js';
import { fmtAmount } from '../format.js';
import type { Rule } from '../types.js';

type TotalsField = keyof CalculatedInvoice['totals'];

function totalRule(id: string, businessTerm: string, field: TotalsField, description: string, formula: string, expected: (inv: CalculatedInvoice) => Decimal): Rule {
  return {
    id,
    businessTerm,
    severity: 'error',
    source: 'EN16931',
    description,
    check({ invoice, report }) {
      const actual = invoice.totals[field];
      const exp = expected(invoice);
      if (!actual.eq(exp)) {
        report({
          path: `totals.${field}`,
          message: `${description.replace(/\.$/, '')}: ${fmtAmount(actual)} does not match ${formula} (expected: ${fmtAmount(exp)}).`,
          hint: 'Totals are computed by the library itself; this state suggests the calculated object was changed afterwards.',
        });
      }
    },
  };
}

export const TOTALS_RULES: readonly Rule[] = [
  totalRule('BR-CO-10', 'BT-106', 'lineTotal', 'Sum of the invoice line net amounts.', 'sum of line net amounts', (i) => sum(i.lines.map((l) => l.netAmount))),
  totalRule('BR-CO-11', 'BT-107', 'allowanceTotal', 'Sum of the document level allowances.', 'sum of document level allowances', (i) => sum(i.allowances.map((a) => a.amount))),
  totalRule('BR-CO-12', 'BT-108', 'chargeTotal', 'Sum of the document level charges.', 'sum of document level charges', (i) => sum(i.charges.map((c) => c.amount))),
  totalRule('BR-CO-13', 'BT-109', 'taxExclusiveAmount', 'Total amount without VAT.', 'line total minus allowances plus charges', (i) => i.totals.lineTotal.minus(i.totals.allowanceTotal).plus(i.totals.chargeTotal)),
  totalRule('BR-CO-14', 'BT-110', 'taxTotal', 'Total VAT amount.', 'sum of the tax amounts in the breakdown', (i) => sum(i.vatBreakdown.map((b) => b.taxAmount))),
  totalRule('BR-CO-15', 'BT-112', 'taxInclusiveAmount', 'Total amount with VAT.', 'tax exclusive amount plus VAT', (i) => i.totals.taxExclusiveAmount.plus(i.totals.taxTotal)),
  totalRule('BR-CO-16', 'BT-115', 'payableAmount', 'Amount due for payment.', 'tax inclusive amount minus paid amount plus rounding', (i) => i.totals.taxInclusiveAmount.minus(i.totals.prepaidAmount).plus(i.totals.roundingAmount)),
];
