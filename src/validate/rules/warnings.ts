/**
 * Warnings (`IF-WARN-*`): questionable in substance, or relevant under German law (Section 14
 * UStG), but not hard-required by EN 16931. They never produce an error.
 */
import { VAT_CATEGORIES } from '../../model/input.js';
import { fmtAmount, fmtNumber, fmtRate } from '../format.js';
import type { Rule } from '../types.js';
import { taxedItemsOfCategory } from './categories.js';

export const WARNING_RULES: readonly Rule[] = [
  {
    id: 'IF-WARN-001',
    businessTerm: 'BT-129',
    severity: 'warning',
    source: 'einvoice',
    description: 'Line with quantity 0.',
    check({ invoice, report }) {
      invoice.lines.forEach((l, i) => {
        if (l.quantity.isZero()) {
          report({
            path: `lines[${String(i)}].quantity`,
            message: `Line ${l.id} ("${l.name}") has quantity 0 and does not contribute to the invoice.`,
            hint: 'Remove the line, or provide a quantity. For free items, use quantity > 0 and price 0.',
          });
        }
      });
    },
  },
  {
    id: 'IF-WARN-002',
    businessTerm: 'BT-72',
    severity: 'warning',
    source: 'einvoice',
    description: 'Neither a delivery date nor a billing period is given (Section 14(4) No. 6 UStG).',
    check({ invoice, report }) {
      if (invoice.delivery?.date === undefined && invoice.periodStart === undefined && invoice.periodEnd === undefined) {
        report({
          path: 'delivery.date',
          message: 'The invoice specifies neither a delivery date nor a billing period.',
          hint: 'Under Section 14(4) No. 6 of the German VAT Act (UStG), the date of delivery or supply is mandatory for input VAT deduction: provide delivery.date (or deliveryDate) or periodStart/periodEnd.',
        });
      }
    },
  },
  {
    id: 'IF-WARN-003',
    businessTerm: 'BG-3',
    severity: 'warning',
    source: 'einvoice',
    description: 'A corrective invoice (384) without a reference to the corrected invoice (corresponds to XRechnung BR-DE-26).',
    check({ invoice, report }) {
      if (invoice.typeCode === '384' && invoice.precedingInvoices.length === 0) {
        report({
          path: 'precedingInvoices',
          message: `Invoice ${invoice.number} is marked as a corrective invoice (type 384) but does not reference a corrected invoice.`,
          hint: 'Provide precedingInvoices: [{ number: "INV-…", issueDate: "YYYY-MM-DD" }]. XRechnung expects this (BR-DE-26).',
        });
      }
    },
  },
  {
    id: 'IF-WARN-004',
    businessTerm: 'BT-112',
    severity: 'warning',
    source: 'einvoice',
    description: 'The total invoice amount is 0.',
    check({ invoice, report }) {
      if (invoice.totals.taxInclusiveAmount.isZero()) {
        report({
          path: 'lines',
          message: `The total invoice amount (gross) is ${fmtAmount(invoice.totals.taxInclusiveAmount)}.`,
          hint: 'Check whether quantities, prices, and allowances/charges are complete. A zero-amount invoice is valid but rarely intentional.',
        });
      }
    },
  },
  {
    id: 'IF-WARN-005',
    businessTerm: 'BT-152',
    severity: 'warning',
    source: 'einvoice',
    description: 'Category S with a VAT rate unusual for Germany (not 7% or 19%).',
    check({ invoice, report }) {
      if (invoice.seller.address.country !== 'DE') return;
      const usual = ['7', '19'];
      invoice.lines.forEach((l, i) => {
        if (l.vat.category === 'S' && !usual.includes(l.vat.rate.toString())) {
          report({
            path: `lines[${String(i)}].vat.rate`,
            message: `Line ${l.id} uses standard rate category S with ${fmtRate(l.vat.rate)}; in Germany, 19% (standard rate) and 7% (reduced rate) are common.`,
            hint: 'Check the rate. Agriculture and forestry (flat rates) or foreign rates are possible, in which case this warning does not apply.',
          });
        }
      });
    },
  },
  {
    id: 'IF-WARN-006',
    businessTerm: 'BT-9',
    severity: 'warning',
    source: 'einvoice',
    description: 'Amount due > 0, but neither a due date nor payment terms are given (formerly BR-CO-25).',
    check({ invoice, report }) {
      if (invoice.totals.payableAmount.gt(0) && invoice.dueDate === undefined && invoice.payment?.terms === undefined) {
        report({
          path: 'dueDate',
          message: `The amount due is ${fmtAmount(invoice.totals.payableAmount)}, but the invoice specifies neither a due date (dueDate) nor payment terms (payment.terms).`,
          hint: 'Provide dueDate (e.g. "2026-10-12") or payment.terms (e.g. "Payable within 14 days, net").',
        });
      }
    },
  },
  {
    id: 'IF-WARN-007',
    businessTerm: 'BG-14',
    severity: 'warning',
    source: 'einvoice',
    description: 'The billing period is given with only a start or only an end (EN 16931 allows this, BR-CO-19).',
    check({ invoice, report }) {
      const { periodStart, periodEnd } = invoice;
      if (periodStart !== undefined && periodEnd === undefined) {
        report({ path: 'periodEnd', message: `The billing period starts on ${periodStart} but has no end.`, hint: 'Add periodEnd, or use delivery.date for a single date.' });
      } else if (periodEnd !== undefined && periodStart === undefined) {
        report({ path: 'periodStart', message: `The billing period ends on ${periodEnd} but has no start.`, hint: 'Add periodStart, or use delivery.date for a single date.' });
      }
    },
  },
  {
    id: 'IF-WARN-011',
    businessTerm: 'BT-120',
    severity: 'warning',
    source: 'einvoice',
    description: 'Different VAT exemption reasons within one VAT category; only the first ends up in the breakdown.',
    check({ invoice, report }) {
      for (const category of VAT_CATEGORIES) {
        const items = taxedItemsOfCategory(invoice, category);
        const first = items.find((it) => it.vat.exemptionReason !== undefined || it.vat.exemptionReasonCode !== undefined);
        if (first === undefined) continue;
        for (const it of items) {
          const reasonDiffers = it.vat.exemptionReason !== undefined && first.vat.exemptionReason !== undefined && it.vat.exemptionReason !== first.vat.exemptionReason;
          const codeDiffers = it.vat.exemptionReasonCode !== undefined && first.vat.exemptionReasonCode !== undefined && it.vat.exemptionReasonCode !== first.vat.exemptionReasonCode;
          if (reasonDiffers || codeDiffers) {
            const field = reasonDiffers ? 'exemptionReason' : 'exemptionReasonCode';
            const a = reasonDiffers ? first.vat.exemptionReason : first.vat.exemptionReasonCode;
            const b = reasonDiffers ? it.vat.exemptionReason : it.vat.exemptionReasonCode;
            report({
              path: `${it.path}.vat.${field}`,
              message: `${it.label} specifies VAT exemption reason "${b ?? ''}" for category ${category}, but ${first.label} specifies "${a ?? ''}". Only the first is used in the VAT breakdown.`,
              hint: 'Use the same VAT exemption reason within one category.',
            });
          }
        }
      }
    },
  },
  {
    id: 'IF-WARN-015',
    businessTerm: 'BT-9',
    severity: 'warning',
    source: 'einvoice',
    description: 'The due date is before the issue date.',
    check({ invoice, report }) {
      if (invoice.dueDate !== undefined && invoice.dueDate < invoice.issueDate) {
        report({
          path: 'dueDate',
          message: `The due date (${invoice.dueDate}) is before the issue date (${invoice.issueDate}).`,
          hint: 'For "due immediately", set dueDate = issueDate.',
        });
      }
    },
  },
  {
    id: 'IF-WARN-016',
    businessTerm: 'BT-84',
    severity: 'warning',
    source: 'einvoice',
    description: 'Credit transfer (30/58) without an IBAN; only a warning outside XRechnung (BR-61 in CII only applies once a payment account element is present).',
    profiles: ['basic', 'en16931', 'extended'],
    check({ invoice, report }) {
      const p = invoice.payment;
      if (p !== undefined && ['30', '58'].includes(p.meansCode) && p.iban === undefined) {
        report({
          path: 'payment.iban',
          message: `Payment means ${p.meansCode} (credit transfer) without a recipient IBAN; the buyer cannot make the transfer.`,
          hint: 'Provide payment.iban (BT-84). In XRechnung this is mandatory (BR-DE-23).',
        });
      }
    },
  },
  {
    id: 'IF-WARN-017',
    businessTerm: 'BT-129',
    severity: 'warning',
    source: 'einvoice',
    description: 'Quantity with more than 4 decimal places (not rounded, but unusual).',
    check({ invoice, report }) {
      invoice.lines.forEach((l, i) => {
        if (l.quantity.decimalPlaces() > 4) {
          report({
            path: `lines[${String(i)}].quantity`,
            message: `Line ${l.id} has a quantity with ${String(l.quantity.decimalPlaces())} decimal places (${fmtNumber(l.quantity)}).`,
            hint: 'Check the quantity; EN 16931 does not limit it, but many recipient systems handle at most 4 decimal places.',
          });
        }
      });
    },
  },
];
