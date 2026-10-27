/**
 * Document rules: mandatory fields (BR-01…BR-11, BR-16), line net price (BR-27), reasons for
 * allowances/charges (BR-33/38/42/44), billing period (BR-29), and decimal places (BR-DEC-*).
 */
import type { CalculatedInvoice } from '../../model/calculated.js';
import type { Decimal } from '../../money/index.js';
import { fmtAmount, fmtNumber } from '../format.js';
import type { Rule } from '../types.js';

export const blank = (s: string | undefined): boolean => s === undefined || s.trim() === '';

function required(
  id: string,
  businessTerm: string,
  path: string,
  description: string,
  get: (inv: CalculatedInvoice) => string | undefined,
  what: string,
): Rule {
  return {
    id,
    businessTerm,
    severity: 'error',
    source: 'EN16931',
    description,
    check({ invoice, report }) {
      if (blank(get(invoice))) report({ path, message: `${what} is missing.` });
    },
  };
}

export const DOCUMENT_RULES: readonly Rule[] = [
  required('BR-01', 'BT-24', 'profile', 'Invoice has a specification identifier (profile).', (i) => i.profileUrn, 'The specification identifier (profile URN)'),
  required('BR-02', 'BT-1', 'number', 'Invoice has an invoice number.', (i) => i.number, 'The invoice number'),
  required('BR-03', 'BT-2', 'issueDate', 'Invoice has an issue date.', (i) => i.issueDate, 'The issue date'),
  required('BR-04', 'BT-3', 'type', 'Invoice has an invoice type code.', (i) => i.typeCode, 'The invoice type code'),
  required('BR-05', 'BT-5', 'currency', 'Invoice has a currency code.', (i) => i.currency, 'The currency code'),
  required('BR-06', 'BT-27', 'seller.name', 'Seller name is given.', (i) => i.seller.name, 'The seller name'),
  required('BR-07', 'BT-44', 'buyer.name', 'Buyer name is given.', (i) => i.buyer.name, 'The buyer name'),
  required('BR-09', 'BT-40', 'seller.address.country', 'Seller address has a country code.', (i) => i.seller.address.country, 'The country code of the seller address'),
  required('BR-11', 'BT-55', 'buyer.address.country', 'Buyer address has a country code.', (i) => i.buyer.address.country, 'The country code of the buyer address'),
  {
    id: 'BR-16',
    businessTerm: 'BG-25',
    severity: 'error',
    source: 'EN16931',
    description: 'Invoice has at least one invoice line.',
    check({ invoice, report }) {
      if (invoice.lines.length === 0) {
        report({ path: 'lines', message: 'The invoice does not contain any invoice line.', hint: 'Provide at least one line in `lines`.' });
      }
    },
  },
  {
    id: 'BR-27',
    businessTerm: 'BT-146',
    severity: 'error',
    source: 'EN16931',
    description: 'Item net price must not be negative.',
    check({ invoice, report }) {
      invoice.lines.forEach((l, i) => {
        if (l.unitPrice.isNegative()) {
          report({
            path: `lines[${String(i)}].unitPrice`,
            message: `The unit price of line ${l.id} is negative (${fmtAmount(l.unitPrice)}).`,
            hint: 'Prices are always positive. For credit notes or cancellations, provide a negative quantity or use the "credit-note" type.',
          });
        }
      });
    },
  },
  {
    id: 'BR-33',
    businessTerm: 'BT-97',
    severity: 'error',
    source: 'EN16931',
    description: 'Document level allowance has a reason (text or code).',
    check({ invoice, report }) {
      invoice.allowances.forEach((a, i) => {
        if (blank(a.reason) && blank(a.reasonCode)) {
          report({
            path: `allowances[${String(i)}].reason`,
            message: `The document level allowance of ${fmtAmount(a.amount)} has neither a reason (reason) nor a reason code (reasonCode).`,
            hint: 'Provide a text such as "discount" or "early payment discount", or a code from UNTDID 5189 (e.g. 95 = discount).',
          });
        }
      });
    },
  },
  {
    id: 'BR-38',
    businessTerm: 'BT-104',
    severity: 'error',
    source: 'EN16931',
    description: 'Document level charge has a reason (text or code).',
    check({ invoice, report }) {
      invoice.charges.forEach((c, i) => {
        if (blank(c.reason) && blank(c.reasonCode)) {
          report({
            path: `charges[${String(i)}].reason`,
            message: `The document level charge of ${fmtAmount(c.amount)} has neither a reason (reason) nor a reason code (reasonCode).`,
            hint: 'Provide a text such as "shipping costs" or a code from UNTDID 7161 (e.g. FC = freight charges).',
          });
        }
      });
    },
  },
  {
    id: 'BR-42',
    businessTerm: 'BT-139',
    severity: 'error',
    source: 'EN16931',
    description: 'Line allowance has a reason (text or code).',
    check({ invoice, report }) {
      invoice.lines.forEach((l, i) => {
        l.allowances.forEach((a, j) => {
          if (blank(a.reason) && blank(a.reasonCode)) {
            report({
              path: `lines[${String(i)}].allowances[${String(j)}].reason`,
              message: `The allowance of ${fmtAmount(a.amount)} in line ${l.id} has neither a reason (reason) nor a reason code (reasonCode).`,
              hint: 'Provide a text such as "discount", or a code from UNTDID 5189 (e.g. 95 = discount).',
            });
          }
        });
      });
    },
  },
  {
    id: 'BR-44',
    businessTerm: 'BT-144',
    severity: 'error',
    source: 'EN16931',
    description: 'Line charge has a reason (text or code).',
    check({ invoice, report }) {
      invoice.lines.forEach((l, i) => {
        l.charges.forEach((c, j) => {
          if (blank(c.reason) && blank(c.reasonCode)) {
            report({
              path: `lines[${String(i)}].charges[${String(j)}].reason`,
              message: `The charge of ${fmtAmount(c.amount)} in line ${l.id} has neither a reason (reason) nor a reason code (reasonCode).`,
              hint: 'Provide a text such as "shipping costs", or a code from UNTDID 7161 (e.g. FC = freight charges).',
            });
          }
        });
      });
    },
  },
  {
    id: 'BR-29',
    businessTerm: 'BT-74',
    severity: 'error',
    source: 'EN16931',
    description: 'End of the billing period is not before its start.',
    check({ invoice, report }) {
      const { periodStart, periodEnd } = invoice;
      if (periodStart !== undefined && periodEnd !== undefined && periodEnd < periodStart) {
        report({
          path: 'periodEnd',
          message: `The end of the billing period (${periodEnd}) is before its start (${periodStart}).`,
          hint: 'Swap or correct periodStart and periodEnd.',
        });
      }
    },
  },
];

/** BR-DEC-*: input amounts may have at most 2 decimal places; we never round silently. */
interface DecimalsTarget {
  path: string;
  value: Decimal;
  label: string;
}

function decimalsRule(id: string, businessTerm: string, description: string, collect: (inv: CalculatedInvoice) => DecimalsTarget[]): Rule {
  return {
    id,
    businessTerm,
    severity: 'error',
    source: 'EN16931',
    description,
    check({ invoice, report }) {
      for (const { path, value, label } of collect(invoice)) {
        if (value.decimalPlaces() > 2) {
          report({
            path,
            message: `${label} has ${String(value.decimalPlaces())} decimal places (${fmtNumber(value)}), at most 2 are allowed.`,
            hint: `Round the amount to 2 decimal places and pass it as such (e.g. ${fmtAmount(value)}). We never round input amounts silently.`,
          });
        }
      }
    },
  };
}

export const DECIMALS_RULES: readonly Rule[] = [
  decimalsRule('BR-DEC-16', 'BT-113', 'Paid amount has at most 2 decimal places.', (inv) => [{ path: 'prepaidAmount', value: inv.prepaidAmount, label: 'The paid amount (prepaidAmount)' }]),
  decimalsRule('BR-DEC-17', 'BT-114', 'Rounding amount has at most 2 decimal places.', (inv) => [{ path: 'roundingAmount', value: inv.roundingAmount, label: 'The rounding amount (roundingAmount)' }]),
  decimalsRule('BR-DEC-01', 'BT-92', 'Document level allowance amount has at most 2 decimal places.', (inv) =>
    inv.allowances.flatMap((a, i) => (a.value.kind === 'amount' ? [{ path: `allowances[${String(i)}].amount`, value: a.value.amount, label: 'The allowance amount' }] : [])),
  ),
  decimalsRule('BR-DEC-05', 'BT-99', 'Document level charge amount has at most 2 decimal places.', (inv) =>
    inv.charges.flatMap((c, i) => (c.value.kind === 'amount' ? [{ path: `charges[${String(i)}].amount`, value: c.value.amount, label: 'The charge amount' }] : [])),
  ),
  decimalsRule('BR-DEC-24', 'BT-136', 'Line allowance amount has at most 2 decimal places.', (inv) =>
    inv.lines.flatMap((l, i) =>
      l.allowances.flatMap((a, j) => (a.value.kind === 'amount' ? [{ path: `lines[${String(i)}].allowances[${String(j)}].amount`, value: a.value.amount, label: `The allowance amount in line ${l.id}` }] : [])),
    ),
  ),
  decimalsRule('BR-DEC-27', 'BT-141', 'Line charge amount has at most 2 decimal places.', (inv) =>
    inv.lines.flatMap((l, i) =>
      l.charges.flatMap((c, j) => (c.value.kind === 'amount' ? [{ path: `lines[${String(i)}].charges[${String(j)}].amount`, value: c.value.amount, label: `The charge amount in line ${l.id}` }] : [])),
    ),
  ),
  {
    id: 'IF-DEC-001',
    businessTerm: 'BT-146',
    severity: 'error',
    source: 'einvoice',
    description: 'Item net price has at most 4 decimal places.',
    check({ invoice, report }) {
      invoice.lines.forEach((l, i) => {
        const places = l.unitPrice.decimalPlaces();
        if (places > 4) {
          report({
            path: `lines[${String(i)}].unitPrice`,
            message: `The unit price of line ${l.id} has ${String(places)} decimal places (${fmtNumber(l.unitPrice)}), at most 4 are allowed.`,
            hint: 'Round the price to 4 decimal places, or use priceBaseQuantity (e.g. a price per 1000 units).',
          });
        }
      });
    },
  },
];
