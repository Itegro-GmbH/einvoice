/**
 * VAT category rule blocks (BR-S, BR-Z, BR-E, BR-AE, BR-IC, BR-G, BR-O, BR-AF, BR-AG).
 *
 * Each category has the same block of 10 rules (-01 … -10), which differ only in their
 * parameters (which identifiers, which rate, exemption reason required or forbidden).
 * They are therefore generated from a specification. In addition: BR-O-11…14 (no mixing) and
 * BR-IC-11/12 (delivery date, delivery country).
 *
 * Source of the IDs and wording: EN16931-CII-validation.xslt 1.3.16 (the EN 16931 CII Schematron shipped with this package).
 */
import type { CalculatedInvoice, VatBreakdownEntry } from '../../model/calculated.js';
import type { VatCategory } from '../../model/input.js';
import type { NormalizedVat } from '../../model/normalized.js';
import { HUNDRED, round2, sum, type Decimal } from '../../money/index.js';
import { fmtAmount, fmtRate } from '../format.js';
import type { Finding, Rule, RuleContext } from '../types.js';
import { blank } from './document.js';

interface CategorySpec {
  code: VatCategory;
  /** Rule prefix, e.g. "IC" for category K. */
  prefix: string;
  /** English label used in messages. */
  label: string;
  /** How many breakdown groups the category may have. */
  breakdown: 'atLeastOne' | 'exactlyOne';
  /** Which seller identifier is required. */
  seller: 'va-or-fc' | 'va' | 'forbidden' | 'none';
  /** Which buyer identifier is required. */
  buyer: 'va-or-legal' | 'va' | 'forbidden' | 'none';
  rate: 'gt0' | 'zero' | 'gte0';
  exemption: 'required' | 'forbidden';
  /** Tax amount in the breakdown: 0 or a formula (the formula covers BR-CO-17 generically). */
  taxAmount: 'zero' | 'formula';
}

export const CATEGORY_SPECS: readonly CategorySpec[] = [
  { code: 'S', prefix: 'S', label: 'S (standard rate)', breakdown: 'atLeastOne', seller: 'va-or-fc', buyer: 'none', rate: 'gt0', exemption: 'forbidden', taxAmount: 'formula' },
  { code: 'Z', prefix: 'Z', label: 'Z (zero rate)', breakdown: 'exactlyOne', seller: 'va-or-fc', buyer: 'none', rate: 'zero', exemption: 'forbidden', taxAmount: 'zero' },
  { code: 'E', prefix: 'E', label: 'E (exempt from VAT)', breakdown: 'exactlyOne', seller: 'va-or-fc', buyer: 'none', rate: 'zero', exemption: 'required', taxAmount: 'zero' },
  { code: 'AE', prefix: 'AE', label: 'AE (reverse charge)', breakdown: 'exactlyOne', seller: 'va-or-fc', buyer: 'va-or-legal', rate: 'zero', exemption: 'required', taxAmount: 'zero' },
  { code: 'K', prefix: 'IC', label: 'K (intra-community supply)', breakdown: 'exactlyOne', seller: 'va', buyer: 'va', rate: 'zero', exemption: 'required', taxAmount: 'zero' },
  { code: 'G', prefix: 'G', label: 'G (export)', breakdown: 'exactlyOne', seller: 'va', buyer: 'none', rate: 'zero', exemption: 'required', taxAmount: 'zero' },
  { code: 'O', prefix: 'O', label: 'O (not subject to VAT)', breakdown: 'exactlyOne', seller: 'forbidden', buyer: 'forbidden', rate: 'zero', exemption: 'required', taxAmount: 'zero' },
  { code: 'L', prefix: 'AF', label: 'L (IGIC, Canary Islands)', breakdown: 'atLeastOne', seller: 'va-or-fc', buyer: 'none', rate: 'gt0', exemption: 'forbidden', taxAmount: 'formula' },
  { code: 'M', prefix: 'AG', label: 'M (IPSI, Ceuta/Melilla)', breakdown: 'atLeastOne', seller: 'va-or-fc', buyer: 'none', rate: 'gte0', exemption: 'forbidden', taxAmount: 'formula' },
];

/** An item carrying a VAT category: line, document level allowance, or document level charge. */
interface TaxedItem {
  kind: 'line' | 'allowance' | 'charge';
  index: number;
  path: string;
  label: string;
  vat: NormalizedVat;
  /** Net amount of the item (BT-131 resp. BT-92/BT-99). */
  amount: Decimal;
}

function items(inv: CalculatedInvoice): TaxedItem[] {
  return [
    ...inv.lines.map((l, i): TaxedItem => ({ kind: 'line', index: i, path: `lines[${String(i)}]`, label: `Line ${l.id}`, vat: l.vat, amount: l.netAmount })),
    ...inv.allowances.map((a, i): TaxedItem => ({ kind: 'allowance', index: i, path: `allowances[${String(i)}]`, label: `Allowance allowances[${String(i)}]`, vat: a.vat, amount: a.amount })),
    ...inv.charges.map((c, i): TaxedItem => ({ kind: 'charge', index: i, path: `charges[${String(i)}]`, label: `Charge charges[${String(i)}]`, vat: c.vat, amount: c.amount })),
  ];
}

const ofCategory = (inv: CalculatedInvoice, code: VatCategory): TaxedItem[] => items(inv).filter((it) => it.vat.category === code);

const RATE_TERM: Record<TaxedItem['kind'], string> = { line: 'BT-152', allowance: 'BT-96', charge: 'BT-103' };
const CATEGORY_TERM: Record<TaxedItem['kind'], string> = { line: 'BT-151', allowance: 'BT-95', charge: 'BT-102' };

function rule(id: string, businessTerm: string, description: string, check: (ctx: RuleContext) => void): Rule {
  return { id, businessTerm, severity: 'error', source: 'EN16931', description, check };
}

// ---------------------------------------------------------------------------------------------
// Identifiers (-02 lines, -03 allowances, -04 charges)

function hasSellerVa(inv: CalculatedInvoice): boolean {
  return !blank(inv.seller.vatId);
}
function hasSellerFc(inv: CalculatedInvoice): boolean {
  return !blank(inv.seller.taxNumber);
}
function hasBuyerVa(inv: CalculatedInvoice): boolean {
  return !blank(inv.buyer.vatId);
}
function hasBuyerLegal(inv: CalculatedInvoice): boolean {
  return inv.buyer.legalRegistration !== undefined && !blank(inv.buyer.legalRegistration.id);
}

function identifierFindings(spec: CategorySpec, inv: CalculatedInvoice, first: TaxedItem): Finding[] {
  const out: Finding[] = [];
  const where = `${first.label} uses VAT category ${spec.label}`;
  switch (spec.seller) {
    case 'va-or-fc':
      if (!hasSellerVa(inv) && !hasSellerFc(inv)) {
        out.push({
          path: 'seller.vatId',
          businessTerm: 'BT-31',
          message: `${where}; this requires the seller "${inv.seller.name}" to have a VAT identifier (seller.vatId) or a tax number (seller.taxNumber).`,
          hint: 'Provide seller.vatId (e.g. "DE123456789") or seller.taxNumber.',
        });
      }
      break;
    case 'va':
      if (!hasSellerVa(inv)) {
        out.push({
          path: 'seller.vatId',
          businessTerm: 'BT-31',
          message: `${where}; this requires the seller "${inv.seller.name}" to have a VAT identifier (seller.vatId); a tax number is not sufficient here.`,
          hint: 'Provide seller.vatId (e.g. "DE123456789").',
        });
      }
      break;
    case 'forbidden':
      if (hasSellerVa(inv)) {
        out.push({
          path: 'seller.vatId',
          businessTerm: 'BT-31',
          message: `${where}; in that case the invoice must not contain a seller VAT identifier (given: "${inv.seller.vatId ?? ''}").`,
          hint: 'Remove seller.vatId (seller.taxNumber or seller.legalRegistration remain allowed). If the transaction is merely exempt from VAT rather than out of scope, use category E or AE.',
        });
      }
      break;
    case 'none':
      break;
  }
  switch (spec.buyer) {
    case 'va-or-legal':
      if (!hasBuyerVa(inv) && !hasBuyerLegal(inv)) {
        out.push({
          path: 'buyer.vatId',
          businessTerm: 'BT-48',
          message: spec.code === 'AE' ? 'For reverse charge, the VAT identifier of the recipient is required.' : `${where}; this requires the buyer to have a VAT identifier or a legal registration number.`,
          hint: `Provide buyer.vatId (e.g. "ATU12345678"); alternatively buyer.legalRegistration.id (legal registration number, BT-47).`,
        });
      }
      break;
    case 'va':
      if (!hasBuyerVa(inv)) {
        out.push({
          path: 'buyer.vatId',
          businessTerm: 'BT-48',
          message: `${where}; this requires the buyer "${inv.buyer.name}" to have a VAT identifier (buyer.vatId).`,
          hint: 'Provide buyer.vatId (e.g. "ATU12345678"). Without a valid VAT identifier of the acquirer, the supply is not tax-exempt.',
        });
      }
      break;
    case 'forbidden':
      if (hasBuyerVa(inv)) {
        out.push({
          path: 'buyer.vatId',
          businessTerm: 'BT-48',
          message: `${where}; in that case the invoice must not contain a buyer VAT identifier (given: "${inv.buyer.vatId ?? ''}").`,
          hint: 'Remove buyer.vatId. If the transaction is merely exempt from VAT rather than out of scope, use category E or AE.',
        });
      }
      break;
    case 'none':
      break;
  }
  return out;
}

function identifierRule(spec: CategorySpec, n: 2 | 3 | 4, kind: TaxedItem['kind']): Rule {
  const what = { line: 'Invoice line', allowance: 'Document level allowance', charge: 'Document level charge' }[kind];
  const need = spec.seller === 'forbidden' ? 'must not contain a seller/buyer VAT identifier' : 'requires the matching seller/buyer identifiers';
  return rule(`BR-${spec.prefix}-0${String(n)}`, 'BT-31', `${what} with category ${spec.label} ${need}.`, ({ invoice, report }) => {
    const first = ofCategory(invoice, spec.code).find((it) => it.kind === kind);
    if (first === undefined) return;
    for (const f of identifierFindings(spec, invoice, first)) report(f);
  });
}

// ---------------------------------------------------------------------------------------------
// VAT rate (-05 lines, -06 allowances, -07 charges)

function rateFinding(spec: CategorySpec, it: TaxedItem): Finding | undefined {
  const r = it.vat.rate;
  const base = `${it.label} uses VAT category ${spec.label} with ${fmtRate(r)}`;
  const path = `${it.path}.vat.rate`;
  const businessTerm = RATE_TERM[it.kind];
  switch (spec.rate) {
    case 'gt0':
      return r.gt(0)
        ? undefined
        : { path, businessTerm, message: `${base}; the rate must be greater than 0.`, hint: 'Provide vat.rate (e.g. 19 or 7). For 0%, use category Z (zero rate), E (exempt from VAT), or AE (reverse charge) instead.' };
    case 'zero':
      return r.isZero()
        ? undefined
        : {
            path,
            businessTerm,
            message: `${base}; the rate must be 0${spec.code === 'O' ? ' or omitted' : ''}.`,
            hint: 'Omit vat.rate or set it to 0. If VAT should be charged, use category S.',
          };
    case 'gte0':
      return r.gte(0) ? undefined : { path, businessTerm, message: `${base}; the rate must not be negative.`, hint: 'Set vat.rate to 0 or a positive value.' };
  }
}

function rateRule(spec: CategorySpec, n: 5 | 6 | 7, kind: TaxedItem['kind']): Rule {
  const what = { line: 'Invoice line', allowance: 'Document level allowance', charge: 'Document level charge' }[kind];
  const cond = { gt0: 'rate > 0', zero: 'rate 0', gte0: 'rate >= 0' }[spec.rate];
  return rule(`BR-${spec.prefix}-0${String(n)}`, RATE_TERM[kind], `${what} with category ${spec.label}: ${cond}.`, ({ invoice, report }) => {
    for (const it of ofCategory(invoice, spec.code)) {
      if (it.kind !== kind) continue;
      const f = rateFinding(spec, it);
      if (f) report(f);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Breakdown (-01 existence, -08 taxable amount, -09 tax amount)

function breakdownsOf(inv: CalculatedInvoice, code: VatCategory): { entry: VatBreakdownEntry; index: number }[] {
  return inv.vatBreakdown.map((entry, index) => ({ entry, index })).filter((b) => b.entry.category === code);
}

function existenceRule(spec: CategorySpec): Rule {
  const cond = spec.breakdown === 'exactlyOne' ? 'exactly one' : 'at least one';
  return rule(`BR-${spec.prefix}-01`, 'BT-118', `An invoice with category ${spec.label} contains ${cond} VAT breakdown group of this category.`, ({ invoice, report }) => {
    const used = ofCategory(invoice, spec.code);
    if (used.length === 0) return;
    const groups = breakdownsOf(invoice, spec.code);
    if (groups.length === 0) {
      report({ path: 'vatBreakdown', message: `The invoice uses VAT category ${spec.label} (${used[0]?.label ?? ''}), but has no VAT breakdown group of this category.`, hint: 'Internal calculation error, please report this.' });
    } else if (spec.breakdown === 'exactlyOne' && groups.length > 1) {
      report({
        path: 'vatBreakdown',
        message: `VAT category ${spec.label} has ${String(groups.length)} breakdown groups (rates ${groups.map((g) => fmtRate(g.entry.rate)).join(', ')}); exactly one is allowed.`,
        hint: 'All items of this category must have the same rate (0).',
      });
    }
  });
}

function taxableRule(spec: CategorySpec): Rule {
  return rule(`BR-${spec.prefix}-08`, 'BT-116', `Taxable amount for ${spec.label} = sum of lines minus allowances plus charges of this category and rate.`, ({ invoice, report }) => {
    for (const { entry, index } of breakdownsOf(invoice, spec.code)) {
      const same = ofCategory(invoice, spec.code).filter((it) => it.vat.rate.eq(entry.rate));
      const expected = sum(same.filter((it) => it.kind === 'line').map((it) => it.amount))
        .minus(sum(same.filter((it) => it.kind === 'allowance').map((it) => it.amount)))
        .plus(sum(same.filter((it) => it.kind === 'charge').map((it) => it.amount)));
      if (!entry.taxableAmount.eq(expected)) {
        report({
          path: `vatBreakdown[${String(index)}].taxableAmount`,
          message: `The taxable amount ${fmtAmount(entry.taxableAmount)} for ${spec.label} at ${fmtRate(entry.rate)} does not match the sum of the associated lines and allowances/charges (expected: ${fmtAmount(expected)}).`,
          hint: 'Totals are computed by the library itself; this state suggests the calculated object was changed afterwards.',
        });
      }
    }
  });
}

function zeroTaxRule(spec: CategorySpec): Rule {
  return rule(`BR-${spec.prefix}-09`, 'BT-117', `The tax amount of the ${spec.label} breakdown group is 0.`, ({ invoice, report }) => {
    for (const { entry, index } of breakdownsOf(invoice, spec.code)) {
      if (!entry.taxAmount.isZero()) {
        report({
          path: `vatBreakdown[${String(index)}].taxAmount`,
          message: `The tax amount for ${spec.label} is ${fmtAmount(entry.taxAmount)}, but must be 0.00.`,
          hint: 'The rate of this category must be 0 (see BR-' + spec.prefix + '-05).',
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// VAT exemption reason (-10)

function exemptionRule(spec: CategorySpec): Rule {
  if (spec.exemption === 'forbidden') {
    return rule(`BR-${spec.prefix}-10`, 'BT-120', `Category ${spec.label} has no VAT exemption reason (text or code).`, ({ invoice, report }) => {
      for (const it of ofCategory(invoice, spec.code)) {
        if (!blank(it.vat.exemptionReason)) {
          report({
            path: `${it.path}.vat.exemptionReason`,
            businessTerm: 'BT-120',
            message: `${it.label} uses VAT category ${spec.label} but still specifies a VAT exemption reason ("${it.vat.exemptionReason ?? ''}").`,
            hint: 'Remove exemptionReason. VAT exemption reasons only apply to E, AE, K, G, and O.',
          });
        } else if (!blank(it.vat.exemptionReasonCode)) {
          report({
            path: `${it.path}.vat.exemptionReasonCode`,
            businessTerm: 'BT-121',
            message: `${it.label} uses VAT category ${spec.label} but still specifies a VAT exemption reason code ("${it.vat.exemptionReasonCode ?? ''}").`,
            hint: 'Remove exemptionReasonCode. VAT exemption reasons only apply to E, AE, K, G, and O.',
          });
        }
      }
    });
  }
  const hint =
    spec.code === 'E'
      ? 'Provide vat.exemptionReason with the legal basis (e.g. "Exempt under Section 4 No. 14 of the German VAT Act (UStG)") or vat.exemptionReasonCode from the VATEX list (e.g. "VATEX-EU-132-1C").'
      : `Provide vat.exemptionReason or vat.exemptionReasonCode (default for ${spec.label}: pre-filled by normalization).`;
  return rule(`BR-${spec.prefix}-10`, 'BT-120', `Category ${spec.label} specifies a VAT exemption reason (text or VATEX code).`, ({ invoice, report }) => {
    const used = ofCategory(invoice, spec.code);
    if (used.length === 0) return;
    const any = used.some((it) => !blank(it.vat.exemptionReason) || !blank(it.vat.exemptionReasonCode));
    if (any) return;
    const first = used[0]!;
    report({
      path: `${first.path}.vat.exemptionReason`,
      message: `${first.label} uses VAT category ${spec.label}, but the VAT exemption reason is missing (neither exemptionReason nor exemptionReasonCode is given).`,
      hint,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Special rules for O (-11 … -14) and IC (-11, -12)

const O_RULES: readonly Rule[] = [
  rule('BR-O-11', 'BT-118', 'An invoice with category O contains no other VAT breakdown groups.', ({ invoice, report }) => {
    if (!invoice.vatBreakdown.some((b) => b.category === 'O')) return;
    const others = invoice.vatBreakdown.filter((b) => b.category !== 'O').map((b) => b.category);
    if (others.length > 0) {
      report({
        path: 'vatBreakdown',
        message: `The invoice contains VAT category O (not subject to VAT) together with ${others.map((c) => `"${c}"`).join(', ')}; O must not be mixed with other categories.`,
        hint: 'Split transactions outside the scope of VAT and taxable transactions across separate invoices.',
      });
    }
  }),
  ...(['line', 'allowance', 'charge'] as const).map((kind, i) =>
    rule(`BR-O-${String(12 + i)}`, CATEGORY_TERM[kind], `An invoice with category O contains no ${{ line: 'line', allowance: 'document level allowances', charge: 'document level charges' }[kind]} of other categories.`, ({ invoice, report }) => {
      if (!invoice.vatBreakdown.some((b) => b.category === 'O')) return;
      for (const it of items(invoice)) {
        if (it.kind === kind && it.vat.category !== 'O') {
          report({
            path: `${it.path}.vat.category`,
            message: `${it.label} has VAT category "${it.vat.category}", but the invoice also contains category O (not subject to VAT); O must not be mixed with other categories.`,
            hint: 'Split transactions outside the scope of VAT and taxable transactions across separate invoices.',
          });
        }
      }
    }),
  ),
];

const IC_RULES: readonly Rule[] = [
  rule('BR-IC-11', 'BT-72', 'An intra-community supply specifies a delivery date or a billing period.', ({ invoice, report }) => {
    if (!invoice.vatBreakdown.some((b) => b.category === 'K')) return;
    if (invoice.delivery?.date === undefined && invoice.periodStart === undefined && invoice.periodEnd === undefined) {
      report({
        path: 'delivery.date',
        message: 'For an intra-community supply (category K), the delivery date or the billing period must be given.',
        hint: 'Provide delivery.date (or deliveryDate) or periodStart/periodEnd.',
      });
    }
  }),
  rule('BR-IC-12', 'BT-80', 'An intra-community supply specifies the country of the delivery address.', ({ invoice, report }) => {
    if (!invoice.vatBreakdown.some((b) => b.category === 'K')) return;
    if (blank(invoice.delivery?.address?.country)) {
      report({
        path: 'delivery.address.country',
        message: 'For an intra-community supply (category K), the delivery address must be given with a country code.',
        hint: 'Provide delivery.address { street, city, postalCode, country }; the destination country establishes the VAT exemption.',
      });
    }
  }),
];

// ---------------------------------------------------------------------------------------------
// BR-CO-17: tax amount = taxable amount x rate / 100, rounded commercially (all categories)

const CO17: Rule = rule('BR-CO-17', 'BT-117', 'Tax amount per breakdown group = taxable amount x rate / 100, rounded to 2 decimal places.', ({ invoice, report }) => {
  invoice.vatBreakdown.forEach((b, i) => {
    const expected = round2(b.taxableAmount.times(b.rate).div(HUNDRED));
    if (!b.taxAmount.eq(expected)) {
      report({
        path: `vatBreakdown[${String(i)}].taxAmount`,
        message: `Tax amount ${fmtAmount(b.taxAmount)} does not match the taxable amount ${fmtAmount(b.taxableAmount)} at ${fmtRate(b.rate)} (expected: ${fmtAmount(expected)}).`,
        hint: 'VAT is calculated per category on the total, not added up per line item.',
      });
    }
  });
});

function categoryBlock(spec: CategorySpec): Rule[] {
  const block: Rule[] = [
    existenceRule(spec),
    identifierRule(spec, 2, 'line'),
    identifierRule(spec, 3, 'allowance'),
    identifierRule(spec, 4, 'charge'),
    rateRule(spec, 5, 'line'),
    rateRule(spec, 6, 'allowance'),
    rateRule(spec, 7, 'charge'),
    taxableRule(spec),
  ];
  if (spec.taxAmount === 'zero') block.push(zeroTaxRule(spec));
  block.push(exemptionRule(spec));
  return block;
}

export const CATEGORY_RULES: readonly Rule[] = [...CATEGORY_SPECS.flatMap(categoryBlock), ...O_RULES, ...IC_RULES, CO17];

/** For warnings: all items of a category in input order (lines, allowances, charges). */
export { ofCategory as taxedItemsOfCategory };
