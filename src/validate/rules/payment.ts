/**
 * Payment data: IBAN/BIC/creditor identifier format (IF-PAY-*), direct debit warnings outside
 * XRechnung. XRechnung-specific payment rules (BR-DE-23/25/30/31) live in profiles.ts.
 */
import { checkBic, checkCreditorId, checkIban } from '../iban.js';
import type { Rule } from '../types.js';

const DIRECT_DEBIT = '59';

export const PAYMENT_RULES: readonly Rule[] = [
  {
    id: 'IF-PAY-001',
    businessTerm: 'BT-84',
    severity: 'error',
    source: 'einvoice',
    description: 'Seller IBAN is formally valid (length per country, mod-97 checksum).',
    check({ invoice, report }) {
      const iban = invoice.payment?.iban;
      if (iban === undefined) return;
      const r = checkIban(iban);
      if (!r.ok) {
        report({
          path: 'payment.iban',
          message: `The IBAN "${iban}" is invalid: ${r.reason}.`,
          hint: 'Provide the IBAN without typos; spaces are allowed. Example: "DE89 3704 0044 0532 0130 00".',
        });
      }
    },
  },
  {
    id: 'IF-PAY-002',
    businessTerm: 'BT-91',
    severity: 'error',
    source: 'einvoice',
    description: 'Buyer IBAN (direct debit) is formally valid.',
    check({ invoice, report }) {
      const iban = invoice.payment?.debitedIban;
      if (iban === undefined) return;
      const r = checkIban(iban);
      if (!r.ok) {
        report({
          path: 'payment.debitedIban',
          message: `The buyer IBAN "${iban}" is invalid: ${r.reason}.`,
          hint: 'Check the IBAN of the debited account.',
        });
      }
    },
  },
  {
    id: 'IF-PAY-003',
    businessTerm: 'BT-86',
    severity: 'error',
    source: 'einvoice',
    description: 'BIC has the format defined in ISO 9362 (8 or 11 characters).',
    check({ invoice, report }) {
      const bic = invoice.payment?.bic;
      if (bic === undefined) return;
      if (!checkBic(bic)) {
        report({
          path: 'payment.bic',
          message: `The BIC "${bic}" does not have the format defined in ISO 9362 (8 or 11 characters, e.g. "COBADEFFXXX").`,
          hint: 'Check the BIC or omit it; within the SEPA area the IBAN is sufficient.',
        });
      }
    },
  },
  {
    id: 'IF-PAY-004',
    businessTerm: 'BT-90',
    severity: 'error',
    source: 'einvoice',
    description: 'Creditor identifier is formally valid (mod-97).',
    check({ invoice, report }) {
      const id = invoice.payment?.creditorId;
      if (id === undefined) return;
      if (!checkCreditorId(id)) {
        report({
          path: 'payment.creditorId',
          message: `The creditor identifier "${id}" is invalid (format or checksum).`,
          hint: 'Format: country (2) + check digits (2) + business area code (3) + national identifier, e.g. "DE98ZZZ09999999999".',
        });
      }
    },
  },
  {
    id: 'IF-WARN-008',
    businessTerm: 'BT-89',
    severity: 'warning',
    source: 'einvoice',
    description: 'SEPA direct debit without a mandate reference.',
    check({ invoice, report }) {
      const p = invoice.payment;
      if (p?.meansCode === DIRECT_DEBIT && p.mandateReference === undefined) {
        report({
          path: 'payment.mandateReference',
          message: 'Payment means 59 (SEPA direct debit) without a mandate reference; the buyer cannot match the debit.',
          hint: 'Provide payment.mandateReference with the reference of the SEPA mandate.',
        });
      }
    },
  },
  {
    id: 'IF-WARN-009',
    businessTerm: 'BT-90',
    severity: 'warning',
    source: 'einvoice',
    profiles: ['basic', 'en16931', 'extended'],
    description: 'SEPA direct debit without a creditor identifier (error BR-DE-30 in XRechnung).',
    check({ invoice, report }) {
      const p = invoice.payment;
      if (p?.meansCode === DIRECT_DEBIT && p.creditorId === undefined) {
        report({
          path: 'payment.creditorId',
          message: 'Payment means 59 (SEPA direct debit) without a creditor identifier.',
          hint: 'Provide payment.creditorId (e.g. "DE98ZZZ09999999999"). In XRechnung this is mandatory (BR-DE-30).',
        });
      }
    },
  },
  {
    id: 'IF-WARN-010',
    businessTerm: 'BT-91',
    severity: 'warning',
    source: 'einvoice',
    profiles: ['basic', 'en16931', 'extended'],
    description: 'SEPA direct debit without the buyer IBAN (error BR-DE-31 in XRechnung).',
    check({ invoice, report }) {
      const p = invoice.payment;
      if (p?.meansCode === DIRECT_DEBIT && p.debitedIban === undefined) {
        report({
          path: 'payment.debitedIban',
          message: 'Payment means 59 (SEPA direct debit) without the IBAN of the debited account.',
          hint: 'Provide payment.debitedIban (buyer IBAN, BT-91). payment.iban is the seller IBAN and belongs to credit transfers.',
        });
      }
    },
  },
];
