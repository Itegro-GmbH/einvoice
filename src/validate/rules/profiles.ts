/**
 * Profile rules.
 *
 * XRechnung (BR-DE-*): source XRechnung-CII-validation.sch (KoSIT, github.com/itplr-kosit/xrechnung-schematron,
 * master as of 2026-09-12, compatible with XRechnung 3.0). IDs and severities as there:
 * BR-DE-1/2/5/6/7/15/18/23/25/30/31 fatal, BR-DE-27 warning. BR-DE-3/4/8/9/10/11 (city/postal code) are
 * guaranteed by the Zod schema, BR-DE-14/21 are a matter of serialization, BR-DE-16/17 are covered by
 * the category rules resp. the type enum. Electronic addresses (BT-34/BT-49) are mandatory in the
 * XRechnung specification (cardinality 1..1) but have no Schematron ID -> IF-XR-001/002.
 *
 * Factur-X BASIC: source FACTUR-X_BASIC.xsd / .sch 1.09.2 (mirror github.com/ZUGFeRD/mustangproject,
 * validator/src/main/resources/{schema,schematron}/ZF_250). Not present there: DefinedTradeContact (BG-6/BG-9),
 * SpecifiedTradeProduct/Description (BT-154), PayeeSpecifiedCreditorFinancialInstitution (BT-86), AccountName (BT-85);
 * at the line level, CalculationPercent/BasisAmount (BT-137/138, BT-142/143) are "not used".
 */
import { fmtAmount, fmtNumber } from '../format.js';
import type { Rule } from '../types.js';
import { blank } from './document.js';

const XR = ['xrechnung'] as const;
const CREDIT_TRANSFER = ['30', '58'];
const DIRECT_DEBIT = '59';

/** BR-DE-18: every line in BT-20 starting with "#" must match this pattern. */
export const XR_SKONTO_REGEX = /^#SKONTO#TAGE=[0-9]+#PROZENT=[0-9]+\.[0-9]{2}(#BASISBETRAG=-?[0-9]+\.[0-9]{2})?#$/;

function xr(id: string, businessTerm: string, description: string, check: Rule['check'], severity: Rule['severity'] = 'error'): Rule {
  return { id, businessTerm, severity, profiles: XR, source: 'XRechnung', description, check };
}

export const XRECHNUNG_RULES: readonly Rule[] = [
  xr('BR-DE-1', 'BG-16', 'XRechnung: payment data (payment) is mandatory.', ({ invoice, report }) => {
    if (invoice.payment === undefined) {
      report({ path: 'payment', message: 'XRechnung requires payment data (payment), e.g. payment means and IBAN.', hint: 'Provide payment: { means: "transfer", iban: "DE…" }.' });
    }
  }),
  xr('BR-DE-2', 'BG-6', 'XRechnung: a seller contact is mandatory.', ({ invoice, report }) => {
    if (invoice.seller.contact === undefined) {
      report({ path: 'seller.contact', message: 'XRechnung requires a seller contact (seller.contact with name, phone, email).', hint: 'Provide seller.contact: { name: "…", phone: "…", email: "…" }.' });
    }
  }),
  xr('BR-DE-5', 'BT-41', 'XRechnung: the seller contact has a name.', ({ invoice, report }) => {
    if (invoice.seller.contact !== undefined && blank(invoice.seller.contact.name)) {
      report({ path: 'seller.contact.name', message: 'XRechnung requires the name of the contact person (seller.contact.name).', hint: 'Provide a person or department, e.g. "Accounting".' });
    }
  }),
  xr('BR-DE-6', 'BT-42', 'XRechnung: the seller contact has a phone number.', ({ invoice, report }) => {
    if (invoice.seller.contact !== undefined && blank(invoice.seller.contact.phone)) {
      report({ path: 'seller.contact.phone', message: 'XRechnung requires a phone number of the contact person (seller.contact.phone).', hint: 'Provide a phone number with at least three digits.' });
    }
  }),
  xr('BR-DE-7', 'BT-43', 'XRechnung: the seller contact has an email address.', ({ invoice, report }) => {
    if (invoice.seller.contact !== undefined && blank(invoice.seller.contact.email)) {
      report({ path: 'seller.contact.email', message: 'XRechnung requires an email address of the contact person (seller.contact.email).', hint: 'Provide an email address.' });
    }
  }),
  xr(
    'BR-DE-27',
    'BT-42',
    'XRechnung: the phone number of the seller contact contains at least three digits.',
    ({ invoice, report }) => {
      const phone = invoice.seller.contact?.phone;
      if (phone !== undefined && (phone.match(/[0-9]/g) ?? []).length < 3) {
        report({ path: 'seller.contact.phone', message: `The phone number "${phone}" contains fewer than three digits.`, hint: 'Provide a complete phone number.' });
      }
    },
    'warning',
  ),
  xr('BR-DE-15', 'BT-10', 'XRechnung: a buyer reference (Leitweg-ID) is mandatory.', ({ invoice, report }) => {
    if (blank(invoice.buyerReference)) {
      report({
        path: 'buyerReference',
        message: 'XRechnung requires a buyer reference (buyerReference); for public sector buyers, the Leitweg-ID (routing identifier).',
        hint: 'Provide buyerReference, e.g. the Leitweg-ID "04011000-12345-03" from the buyer\'s order.',
      });
    }
  }),
  xr('BR-DE-18', 'BT-20', 'XRechnung: early payment discount terms in the payment terms follow the format #SKONTO#TAGE=n#PROZENT=n.nn#.', ({ invoice, report }) => {
    const terms = invoice.payment?.terms;
    if (terms === undefined) return;
    let hasSkonto = false;
    for (const raw of terms.split(/\r?\n/)) {
      const l = raw.trim();
      if (!l.startsWith('#')) continue;
      hasSkonto = true;
      if (!XR_SKONTO_REGEX.test(l)) {
        report({
          path: 'payment.terms',
          message: `The line "${l}" in payment.terms starts with "#" but does not match the XRechnung early payment discount format.`,
          hint: 'Format per line: "#SKONTO#TAGE=7#PROZENT=2.00#" (optionally "#BASISBETRAG=1000.00" before the closing #). Percentage always with two decimal places and a dot.',
        });
      }
    }
    // Second KoSIT condition: a line break must follow the last discount entry (normalize() adds it).
    const tail = terms.split(/#.+#/).at(-1) ?? '';
    if (hasSkonto && !/^\s*\n/.test(tail)) {
      report({
        path: 'payment.terms',
        message: 'A line break must follow the last early payment discount entry in payment.terms.',
        hint: 'Terminate the discount line with "\\n".',
      });
    }
  }),
  xr('IF-XR-001', 'BT-34', 'XRechnung: an electronic address of the seller is mandatory.', ({ invoice, report }) => {
    if (invoice.seller.electronicAddress === undefined) {
      report({
        path: 'seller.electronicAddress',
        message: 'XRechnung requires an electronic address of the seller (seller.electronicAddress).',
        hint: 'Provide seller.electronicAddress: { scheme: "EM", value: "invoice@company.com" } (scheme EM = email).',
      });
    }
  }),
  xr('IF-XR-002', 'BT-49', 'XRechnung: an electronic address of the buyer is mandatory.', ({ invoice, report }) => {
    if (invoice.buyer.electronicAddress === undefined) {
      report({
        path: 'buyer.electronicAddress',
        message: 'XRechnung requires an electronic address of the buyer (buyer.electronicAddress).',
        hint: 'Provide buyer.electronicAddress: { scheme: "EM", value: "…" } (email) or { scheme: "0204", value: "Leitweg-ID" }.',
      });
    }
  }),
  xr('BR-DE-23-a', 'BT-84', 'XRechnung: a credit transfer (30, 58) requires the seller IBAN.', ({ invoice, report }) => {
    const p = invoice.payment;
    if (p !== undefined && CREDIT_TRANSFER.includes(p.meansCode) && p.iban === undefined) {
      report({ path: 'payment.iban', message: `Payment means ${p.meansCode} (credit transfer) requires the seller's account details (payment.iban) in XRechnung.`, hint: 'Provide payment.iban.' });
    }
  }),
  xr('BR-DE-23-b', 'BT-91', 'XRechnung: a credit transfer (30, 58) must not contain direct debit or card data.', ({ invoice, report }) => {
    const p = invoice.payment;
    if (p === undefined || !CREDIT_TRANSFER.includes(p.meansCode)) return;
    for (const [field, bt] of [
      ['debitedIban', 'BT-91'],
      ['mandateReference', 'BT-89'],
      ['creditorId', 'BT-90'],
    ] as const) {
      if (p[field] !== undefined) {
        report({ path: `payment.${field}`, businessTerm: bt, message: `Payment means ${p.meansCode} (credit transfer) must not contain direct debit data (payment.${field} is set).`, hint: `Remove payment.${field} or set means to "sepa-direct-debit".` });
      }
    }
  }),
  xr('BR-DE-25-b', 'BT-84', 'XRechnung: a direct debit (59) must not contain credit transfer or card data.', ({ invoice, report }) => {
    const p = invoice.payment;
    if (p === undefined || p.meansCode !== DIRECT_DEBIT) return;
    for (const [field, bt] of [
      ['iban', 'BT-84'],
      ['bic', 'BT-86'],
      ['accountHolder', 'BT-85'],
    ] as const) {
      if (p[field] !== undefined) {
        report({ path: `payment.${field}`, businessTerm: bt, message: `Payment means 59 (direct debit) must not contain credit transfer data (payment.${field} is set).`, hint: `Remove payment.${field}; the buyer IBAN belongs in payment.debitedIban.` });
      }
    }
  }),
  xr('BR-DE-30', 'BT-90', 'XRechnung: a direct debit (59) requires the creditor identifier.', ({ invoice, report }) => {
    const p = invoice.payment;
    if (p?.meansCode === DIRECT_DEBIT && p.creditorId === undefined) {
      report({ path: 'payment.creditorId', message: 'Payment means 59 (SEPA direct debit) requires the creditor identifier (payment.creditorId) in XRechnung.', hint: 'Provide payment.creditorId, e.g. "DE98ZZZ09999999999".' });
    }
  }),
  xr('BR-DE-31', 'BT-91', 'XRechnung: a direct debit (59) requires the buyer IBAN.', ({ invoice, report }) => {
    const p = invoice.payment;
    if (p?.meansCode === DIRECT_DEBIT && p.debitedIban === undefined) {
      report({ path: 'payment.debitedIban', message: 'Payment means 59 (SEPA direct debit) requires the IBAN of the debited account (payment.debitedIban) in XRechnung.', hint: 'Provide payment.debitedIban (buyer IBAN).' });
    }
  }),
];

const BASIC = ['basic'] as const;

export const BASIC_RULES: readonly Rule[] = [
  {
    id: 'IF-PROFILE-001',
    businessTerm: 'BT-138',
    severity: 'error',
    profiles: BASIC,
    source: 'Factur-X',
    description: 'Factur-X BASIC: line allowances/charges only as an amount, not as a percentage (BT-137/138, BT-142/143 not in this profile).',
    check({ invoice, report }) {
      invoice.lines.forEach((l, i) => {
        l.allowances.forEach((a, j) => {
          if (a.value.kind === 'percent') {
            report({
              path: `lines[${String(i)}].allowances[${String(j)}].percent`,
              businessTerm: 'BT-138',
              message: `Line ${l.id}: a percentage allowance (${fmtNumber(a.value.percent)}%) cannot be represented in profile BASIC.`,
              hint: 'In profile BASIC, provide the allowance as an amount, or use profile "en16931".',
            });
          }
        });
        l.charges.forEach((c, j) => {
          if (c.value.kind === 'percent') {
            report({
              path: `lines[${String(i)}].charges[${String(j)}].percent`,
              businessTerm: 'BT-143',
              message: `Line ${l.id}: a percentage charge (${fmtNumber(c.value.percent)}%) cannot be represented in profile BASIC.`,
              hint: 'In profile BASIC, provide the charge as an amount, or use profile "en16931".',
            });
          }
        });
      });
    },
  },
  {
    id: 'IF-PROFILE-002',
    businessTerm: 'BT-114',
    severity: 'error',
    profiles: BASIC,
    source: 'Factur-X',
    description: 'Factur-X BASIC: the rounding amount (BT-114) cannot be represented in this profile (RoundingAmount is missing from the BASIC XSD).',
    check({ invoice, report }) {
      if (!invoice.totals.roundingAmount.isZero()) {
        report({
          path: 'roundingAmount',
          message: `Rounding amount ${fmtAmount(invoice.totals.roundingAmount)} cannot be represented in profile BASIC (BT-114 is missing from the BASIC XSD).`,
          hint: 'Omit roundingAmount, or use profile "en16931".',
        });
      }
    },
  },
  {
    id: 'IF-WARN-012',
    businessTerm: 'BT-154',
    severity: 'warning',
    profiles: BASIC,
    source: 'Factur-X',
    description: 'Factur-X BASIC: the item description (description) is not carried into the XML.',
    check({ invoice, report }) {
      invoice.lines.forEach((l, i) => {
        if (l.description !== undefined) {
          report({ path: `lines[${String(i)}].description`, message: `Line ${l.id}: the item description is not carried into the XML in profile BASIC (only visible in the PDF).`, hint: 'Use profile "en16931" if the description should be machine-readable.' });
        }
      });
    },
  },
  {
    id: 'IF-WARN-013',
    businessTerm: 'BG-6',
    severity: 'warning',
    profiles: BASIC,
    source: 'Factur-X',
    description: 'Factur-X BASIC: contact data (contact) is not carried into the XML.',
    check({ invoice, report }) {
      if (invoice.seller.contact !== undefined) {
        report({ path: 'seller.contact', businessTerm: 'BG-6', message: 'The seller contact is not carried into the XML in profile BASIC (only visible in the PDF).', hint: 'Use profile "en16931" if the contact should be machine-readable.' });
      }
      if (invoice.buyer.contact !== undefined) {
        report({ path: 'buyer.contact', businessTerm: 'BG-9', message: 'The buyer contact is not carried into the XML in profile BASIC (only visible in the PDF).', hint: 'Use profile "en16931" if the contact should be machine-readable.' });
      }
    },
  },
  {
    id: 'IF-WARN-014',
    businessTerm: 'BT-86',
    severity: 'warning',
    profiles: BASIC,
    source: 'Factur-X',
    description: 'Factur-X BASIC: BIC and account holder are not carried into the XML.',
    check({ invoice, report }) {
      const p = invoice.payment;
      if (p?.bic !== undefined) {
        report({ path: 'payment.bic', businessTerm: 'BT-86', message: 'The BIC is not carried into the XML in profile BASIC (only visible in the PDF).', hint: 'Within the SEPA area the IBAN is sufficient; otherwise use profile "en16931".' });
      }
      if (p?.accountHolder !== undefined) {
        report({ path: 'payment.accountHolder', businessTerm: 'BT-85', message: 'The account holder is not carried into the XML in profile BASIC (only visible in the PDF).', hint: 'Use profile "en16931" if the account holder should be machine-readable.' });
      }
    },
  },
];
