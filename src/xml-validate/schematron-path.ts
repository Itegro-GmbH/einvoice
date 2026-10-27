/**
 * Maps the (already simplified, see `simplifyLocation`) SVRL `location` of a Schematron finding
 * to an input path. The structure is fully known (our own serializer,
 * `serialize/cii/serialize-cii.ts`), so this is a static table "CII element path -> input path"
 * instead of guessing.
 *
 * Principle: `location` is split into named, indexed segments (`rsm:CrossIndustryInvoice[1]/…`).
 * The **longest** prefix of this segment chain that is present in the table is looked up (the
 * "nearest mappable parent path" when the exact node has no counterpart in the input, e.g. a
 * calculated line total falls back to `lines[n]`). Allowances/charges and the second tax
 * identifier of a party (VAT identifier vs. tax number) need the actual invoice (order/count), so
 * the resolver receives the `CalculatedInvoice`.
 *
 * If there is no match at all (e.g. a path outside the known CII namespace), the function returns
 * `undefined`; the caller (`schematronWarning`) then sets `path` to `''` (the invoice as a
 * whole); the original XPath is always additionally available in `xpath` regardless.
 */
import type { CalculatedInvoice, VatBreakdownEntry } from '../model/calculated.js';
import type { NormalizedParty } from '../model/normalized.js';

type Resolver = (idx: readonly number[], invoice: CalculatedInvoice) => string;

interface Segment {
  name: string;
  index: number;
}

const SEGMENT_RE = /^([a-z]+:[A-Za-z_][\w.-]*)\[(\d+)\]$/;

/** `/rsm:Foo[1]/ram:Bar[2]` -> `[{name:'rsm:Foo',index:1},{name:'ram:Bar',index:2}]`; `undefined` for an unknown format. */
function parseSegments(location: string): Segment[] | undefined {
  const parts = location.split('/').filter((p) => p !== '');
  const segments: Segment[] = [];
  for (const part of parts) {
    const m = SEGMENT_RE.exec(part);
    if (m === null) return undefined;
    segments.push({ name: m[1]!, index: Number(m[2]) });
  }
  return segments.length === 0 ? undefined : segments;
}

const AC_SUFFIX_RE = /(?:allowances|charges)\[\d+\]$/;

/** Appends `suffix` only when the base path actually reached an indexed allowances/charges item. */
function withAcSuffix(base: Resolver, suffix: string): Resolver {
  return (idx, invoice) => {
    const b = base(idx, invoice);
    return AC_SUFFIX_RE.test(b) ? `${b}.${suffix}` : b;
  };
}

function lineAllowanceCharge(idx: readonly number[], invoice: CalculatedInvoice): string {
  const lineIdx0 = idx[2]! - 1;
  const m = idx[4]!;
  const line = invoice.lines[lineIdx0];
  const base = `lines[${String(lineIdx0)}]`;
  if (line === undefined) return base;
  if (m <= line.allowances.length) return `${base}.allowances[${String(m - 1)}]`;
  const c = m - line.allowances.length;
  if (c <= line.charges.length) return `${base}.charges[${String(c - 1)}]`;
  return base;
}

function documentAllowanceCharge(idx: readonly number[], invoice: CalculatedInvoice): string {
  const m = idx[3]!;
  if (m <= invoice.allowances.length) return `allowances[${String(m - 1)}]`;
  const c = m - invoice.allowances.length;
  if (c <= invoice.charges.length) return `charges[${String(c - 1)}]`;
  return 'allowances';
}

/** BT-120/BT-121: same derivation as `serialize/cii/serialize-cii.ts#exemptionFor`; the first item (line, allowance, charge) with the same (category, rate). */
function breakdownExemptionPath(invoice: CalculatedInvoice, breakdownIdx0: number, field: 'exemptionReason' | 'exemptionReasonCode'): string {
  const b: VatBreakdownEntry | undefined = invoice.vatBreakdown[breakdownIdx0];
  const fallback = `vatBreakdown[${String(breakdownIdx0)}]`;
  if (b === undefined) return fallback;
  const candidates = [
    ...invoice.lines.map((l, i) => ({ path: `lines[${String(i)}]`, vat: l.vat })),
    ...invoice.allowances.map((a, i) => ({ path: `allowances[${String(i)}]`, vat: a.vat })),
    ...invoice.charges.map((c, i) => ({ path: `charges[${String(i)}]`, vat: c.vat })),
  ];
  const hit = candidates.find((c) => c.vat.category === b.category && c.vat.rate.eq(b.rate) && c.vat[field] !== undefined);
  return hit === undefined ? fallback : `${hit.path}.vat.${field}`;
}

const COMMON2 = ['rsm:CrossIndustryInvoice', 'rsm:SupplyChainTradeTransaction'] as const;

/** All paths below a party (seller/buyer): name, identifiers, contact, address, electronic address, tax identifier. */
function partyRoutes(prefix: readonly string[], base: 'seller' | 'buyer', getParty: (inv: CalculatedInvoice) => NormalizedParty): Record<string, Resolver> {
  const key = (...seg: string[]): string => [...prefix, ...seg].join('/');
  const at = (suffix: string): Resolver => () => `${base}.${suffix}`;
  const taxRegPos = prefix.length; // 0-based position of SpecifiedTaxRegistration in the idx array: this prefix's length + 1 segment
  const resolveTaxReg: Resolver = (idx, invoice) => {
    const party = getParty(invoice);
    const m = idx[taxRegPos]!;
    const present: Array<'vatId' | 'taxNumber'> = [];
    if (party.vatId !== undefined) present.push('vatId');
    if (party.taxNumber !== undefined) present.push('taxNumber');
    const field = present[m - 1] ?? 'vatId';
    return `${base}.${field}`;
  };
  return {
    [key()]: () => base,
    [key('ram:ID')]: at('id'),
    [key('ram:Name')]: at('name'),
    [key('ram:SpecifiedLegalOrganization')]: () => `${base}.legalRegistration`,
    [key('ram:SpecifiedLegalOrganization', 'ram:ID')]: () => `${base}.legalRegistration.id`,
    [key('ram:SpecifiedLegalOrganization', 'ram:TradingBusinessName')]: at('tradingName'),
    [key('ram:DefinedTradeContact')]: () => `${base}.contact`,
    [key('ram:DefinedTradeContact', 'ram:PersonName')]: at('contact.name'),
    [key('ram:DefinedTradeContact', 'ram:TelephoneUniversalCommunication')]: at('contact.phone'),
    [key('ram:DefinedTradeContact', 'ram:TelephoneUniversalCommunication', 'ram:CompleteNumber')]: at('contact.phone'),
    [key('ram:DefinedTradeContact', 'ram:EmailURIUniversalCommunication')]: at('contact.email'),
    [key('ram:DefinedTradeContact', 'ram:EmailURIUniversalCommunication', 'ram:URIID')]: at('contact.email'),
    [key('ram:PostalTradeAddress')]: at('address'),
    [key('ram:PostalTradeAddress', 'ram:PostcodeCode')]: at('address.postalCode'),
    [key('ram:PostalTradeAddress', 'ram:LineOne')]: at('address.street'),
    [key('ram:PostalTradeAddress', 'ram:LineTwo')]: at('address.street2'),
    [key('ram:PostalTradeAddress', 'ram:CityName')]: at('address.city'),
    [key('ram:PostalTradeAddress', 'ram:CountryID')]: at('address.country'),
    [key('ram:URIUniversalCommunication')]: at('electronicAddress'),
    [key('ram:URIUniversalCommunication', 'ram:URIID')]: at('electronicAddress.value'),
    [key('ram:SpecifiedTaxRegistration')]: resolveTaxReg,
    [key('ram:SpecifiedTaxRegistration', 'ram:ID')]: resolveTaxReg,
  };
}

const AGREEMENT_PREFIX = [...COMMON2, 'ram:ApplicableHeaderTradeAgreement'] as const;
const SELLER_PREFIX = [...AGREEMENT_PREFIX, 'ram:SellerTradeParty'] as const;
const BUYER_PREFIX = [...AGREEMENT_PREFIX, 'ram:BuyerTradeParty'] as const;
const LINE_PREFIX = [...COMMON2, 'ram:IncludedSupplyChainTradeLineItem'] as const;
const DELIVERY_PREFIX = [...COMMON2, 'ram:ApplicableHeaderTradeDelivery'] as const;
const SETTLEMENT_PREFIX = [...COMMON2, 'ram:ApplicableHeaderTradeSettlement'] as const;

const line = (...seg: string[]): string => [...LINE_PREFIX, ...seg].join('/');
const settle = (...seg: string[]): string => [...SETTLEMENT_PREFIX, ...seg].join('/');
const deliv = (...seg: string[]): string => [...DELIVERY_PREFIX, ...seg].join('/');
const agree = (...seg: string[]): string => [...AGREEMENT_PREFIX, ...seg].join('/');

const lineIdx = (idx: readonly number[]): number => idx[2]! - 1;
const lineAt = (suffix: string): Resolver => (idx) => `lines[${String(lineIdx(idx))}]${suffix === '' ? '' : `.${suffix}`}`;

const breakdown: Resolver = (idx) => `vatBreakdown[${String(idx[3]! - 1)}]`;
const breakdownAt = (suffix: string): Resolver => (idx, invoice) => `${breakdown(idx, invoice)}.${suffix}`;

const precedingIdx = (idx: readonly number[]): number => idx[3]! - 1;
const precedingAt = (suffix: string): Resolver => (idx) => `precedingInvoices[${String(precedingIdx(idx))}]${suffix === '' ? '' : `.${suffix}`}`;

const TABLE: Record<string, Resolver> = {
  // --- Header --------------------------------------------------------------------------------------------------
  'rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext': () => 'profile',
  'rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter': () => 'profile',
  'rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID': () => 'profile',
  'rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext/ram:BusinessProcessSpecifiedDocumentContextParameter': () => 'profile',
  'rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext/ram:BusinessProcessSpecifiedDocumentContextParameter/ram:ID': () => 'profile',
  'rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:ID': () => 'number',
  'rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:TypeCode': () => 'type',
  'rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:IssueDateTime': () => 'issueDate',
  'rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString': () => 'issueDate',
  'rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:IncludedNote': (idx) => `notes[${String(idx[2]! - 1)}]`,
  'rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:IncludedNote/ram:Content': (idx) => `notes[${String(idx[2]! - 1)}]`,

  [agree('ram:BuyerReference')]: () => 'buyerReference',
  [agree('ram:BuyerOrderReferencedDocument')]: () => 'buyer.orderReference',
  [agree('ram:BuyerOrderReferencedDocument', 'ram:IssuerAssignedID')]: () => 'buyer.orderReference',

  [settle('ram:BillingSpecifiedPeriod', 'ram:StartDateTime')]: () => 'periodStart',
  [settle('ram:BillingSpecifiedPeriod', 'ram:StartDateTime', 'udt:DateTimeString')]: () => 'periodStart',
  [settle('ram:BillingSpecifiedPeriod', 'ram:EndDateTime')]: () => 'periodEnd',
  [settle('ram:BillingSpecifiedPeriod', 'ram:EndDateTime', 'udt:DateTimeString')]: () => 'periodEnd',
  [settle('ram:InvoiceReferencedDocument')]: precedingAt(''),
  [settle('ram:InvoiceReferencedDocument', 'ram:IssuerAssignedID')]: precedingAt('number'),
  [settle('ram:InvoiceReferencedDocument', 'ram:FormattedIssueDateTime')]: precedingAt('issueDate'),
  [settle('ram:InvoiceReferencedDocument', 'ram:FormattedIssueDateTime', 'qdt:DateTimeString')]: precedingAt('issueDate'),

  // --- Seller / buyer --------------------------------------------------------------------------------------
  ...partyRoutes(SELLER_PREFIX, 'seller', (inv) => inv.seller),
  ...partyRoutes(BUYER_PREFIX, 'buyer', (inv) => inv.buyer),

  // --- Indexed lines -------------------------------------------------------------------------------------
  [LINE_PREFIX.join('/')]: lineAt(''),
  [line('ram:AssociatedDocumentLineDocument')]: lineAt(''),
  [line('ram:AssociatedDocumentLineDocument', 'ram:LineID')]: lineAt('id'),
  [line('ram:SpecifiedTradeProduct')]: lineAt(''),
  [line('ram:SpecifiedTradeProduct', 'ram:Name')]: lineAt('name'),
  [line('ram:SpecifiedTradeProduct', 'ram:Description')]: lineAt('description'),
  [line('ram:SpecifiedLineTradeAgreement')]: lineAt(''),
  [line('ram:SpecifiedLineTradeAgreement', 'ram:NetPriceProductTradePrice')]: lineAt('unitPrice'),
  [line('ram:SpecifiedLineTradeAgreement', 'ram:NetPriceProductTradePrice', 'ram:ChargeAmount')]: lineAt('unitPrice'),
  [line('ram:SpecifiedLineTradeAgreement', 'ram:NetPriceProductTradePrice', 'ram:BasisQuantity')]: lineAt('priceBaseQuantity'),
  [line('ram:SpecifiedLineTradeDelivery')]: lineAt('quantity'),
  [line('ram:SpecifiedLineTradeDelivery', 'ram:BilledQuantity')]: lineAt('quantity'),
  [line('ram:SpecifiedLineTradeSettlement')]: lineAt(''),
  [line('ram:SpecifiedLineTradeSettlement', 'ram:ApplicableTradeTax')]: lineAt('vat'),
  [line('ram:SpecifiedLineTradeSettlement', 'ram:ApplicableTradeTax', 'ram:TypeCode')]: lineAt('vat'),
  [line('ram:SpecifiedLineTradeSettlement', 'ram:ApplicableTradeTax', 'ram:CategoryCode')]: lineAt('vat.category'),
  [line('ram:SpecifiedLineTradeSettlement', 'ram:ApplicableTradeTax', 'ram:RateApplicablePercent')]: lineAt('vat.rate'),
  [line('ram:SpecifiedLineTradeSettlement', 'ram:SpecifiedTradeAllowanceCharge')]: lineAllowanceCharge,
  [line('ram:SpecifiedLineTradeSettlement', 'ram:SpecifiedTradeAllowanceCharge', 'ram:ActualAmount')]: withAcSuffix(lineAllowanceCharge, 'amount'),
  [line('ram:SpecifiedLineTradeSettlement', 'ram:SpecifiedTradeAllowanceCharge', 'ram:CalculationPercent')]: withAcSuffix(lineAllowanceCharge, 'percent'),
  [line('ram:SpecifiedLineTradeSettlement', 'ram:SpecifiedTradeAllowanceCharge', 'ram:ReasonCode')]: withAcSuffix(lineAllowanceCharge, 'reasonCode'),
  [line('ram:SpecifiedLineTradeSettlement', 'ram:SpecifiedTradeAllowanceCharge', 'ram:Reason')]: withAcSuffix(lineAllowanceCharge, 'reason'),
  [line('ram:SpecifiedLineTradeSettlement', 'ram:SpecifiedTradeAllowanceCharge', 'ram:ChargeIndicator')]: lineAllowanceCharge,
  [line('ram:SpecifiedLineTradeSettlement', 'ram:SpecifiedTradeAllowanceCharge', 'ram:ChargeIndicator', 'udt:Indicator')]: lineAllowanceCharge,
  [line('ram:SpecifiedLineTradeSettlement', 'ram:SpecifiedTradeSettlementLineMonetarySummation')]: lineAt(''),
  [line('ram:SpecifiedLineTradeSettlement', 'ram:SpecifiedTradeSettlementLineMonetarySummation', 'ram:LineTotalAmount')]: lineAt(''),

  // --- Delivery ------------------------------------------------------------------------------------------------
  [DELIVERY_PREFIX.join('/')]: () => 'delivery',
  [deliv('ram:ShipToTradeParty')]: () => 'delivery',
  [deliv('ram:ShipToTradeParty', 'ram:Name')]: () => 'delivery.recipientName',
  [deliv('ram:ShipToTradeParty', 'ram:PostalTradeAddress')]: () => 'delivery.address',
  [deliv('ram:ShipToTradeParty', 'ram:PostalTradeAddress', 'ram:PostcodeCode')]: () => 'delivery.address.postalCode',
  [deliv('ram:ShipToTradeParty', 'ram:PostalTradeAddress', 'ram:LineOne')]: () => 'delivery.address.street',
  [deliv('ram:ShipToTradeParty', 'ram:PostalTradeAddress', 'ram:LineTwo')]: () => 'delivery.address.street2',
  [deliv('ram:ShipToTradeParty', 'ram:PostalTradeAddress', 'ram:CityName')]: () => 'delivery.address.city',
  [deliv('ram:ShipToTradeParty', 'ram:PostalTradeAddress', 'ram:CountryID')]: () => 'delivery.address.country',
  [deliv('ram:ActualDeliverySupplyChainEvent')]: () => 'delivery.date',
  [deliv('ram:ActualDeliverySupplyChainEvent', 'ram:OccurrenceDateTime')]: () => 'delivery.date',
  [deliv('ram:ActualDeliverySupplyChainEvent', 'ram:OccurrenceDateTime', 'udt:DateTimeString')]: () => 'delivery.date',

  // --- Payment --------------------------------------------------------------------------------------------------
  [settle('ram:CreditorReferenceID')]: () => 'payment.creditorId',
  [settle('ram:PaymentReference')]: () => 'payment.reference',
  [settle('ram:InvoiceCurrencyCode')]: () => 'currency',
  [settle('ram:SpecifiedTradeSettlementPaymentMeans')]: () => 'payment',
  [settle('ram:SpecifiedTradeSettlementPaymentMeans', 'ram:TypeCode')]: () => 'payment.means',
  [settle('ram:SpecifiedTradeSettlementPaymentMeans', 'ram:PayerPartyDebtorFinancialAccount')]: () => 'payment.debitedIban',
  [settle('ram:SpecifiedTradeSettlementPaymentMeans', 'ram:PayerPartyDebtorFinancialAccount', 'ram:IBANID')]: () => 'payment.debitedIban',
  [settle('ram:SpecifiedTradeSettlementPaymentMeans', 'ram:PayeePartyCreditorFinancialAccount')]: () => 'payment.iban',
  [settle('ram:SpecifiedTradeSettlementPaymentMeans', 'ram:PayeePartyCreditorFinancialAccount', 'ram:IBANID')]: () => 'payment.iban',
  [settle('ram:SpecifiedTradeSettlementPaymentMeans', 'ram:PayeePartyCreditorFinancialAccount', 'ram:AccountName')]: () => 'payment.accountHolder',
  [settle('ram:SpecifiedTradeSettlementPaymentMeans', 'ram:PayeeSpecifiedCreditorFinancialInstitution')]: () => 'payment.bic',
  [settle('ram:SpecifiedTradeSettlementPaymentMeans', 'ram:PayeeSpecifiedCreditorFinancialInstitution', 'ram:BICID')]: () => 'payment.bic',
  [settle('ram:SpecifiedTradePaymentTerms')]: () => 'payment.terms',
  [settle('ram:SpecifiedTradePaymentTerms', 'ram:Description')]: () => 'payment.terms',
  [settle('ram:SpecifiedTradePaymentTerms', 'ram:DueDateDateTime')]: () => 'dueDate',
  [settle('ram:SpecifiedTradePaymentTerms', 'ram:DueDateDateTime', 'udt:DateTimeString')]: () => 'dueDate',
  [settle('ram:SpecifiedTradePaymentTerms', 'ram:DirectDebitMandateID')]: () => 'payment.mandateReference',
  [settle('ram:SpecifiedTradeAllowanceCharge')]: documentAllowanceCharge,
  [settle('ram:SpecifiedTradeAllowanceCharge', 'ram:ActualAmount')]: withAcSuffix(documentAllowanceCharge, 'amount'),
  [settle('ram:SpecifiedTradeAllowanceCharge', 'ram:CalculationPercent')]: withAcSuffix(documentAllowanceCharge, 'percent'),
  [settle('ram:SpecifiedTradeAllowanceCharge', 'ram:ReasonCode')]: withAcSuffix(documentAllowanceCharge, 'reasonCode'),
  [settle('ram:SpecifiedTradeAllowanceCharge', 'ram:Reason')]: withAcSuffix(documentAllowanceCharge, 'reason'),
  [settle('ram:SpecifiedTradeAllowanceCharge', 'ram:CategoryTradeTax')]: withAcSuffix(documentAllowanceCharge, 'vat'),
  [settle('ram:SpecifiedTradeAllowanceCharge', 'ram:CategoryTradeTax', 'ram:TypeCode')]: withAcSuffix(documentAllowanceCharge, 'vat'),
  [settle('ram:SpecifiedTradeAllowanceCharge', 'ram:CategoryTradeTax', 'ram:CategoryCode')]: withAcSuffix(documentAllowanceCharge, 'vat.category'),
  [settle('ram:SpecifiedTradeAllowanceCharge', 'ram:CategoryTradeTax', 'ram:RateApplicablePercent')]: withAcSuffix(documentAllowanceCharge, 'vat.rate'),

  // --- Indexed VAT breakdown ----------------------------------------------------------------------------
  [settle('ram:ApplicableTradeTax')]: breakdown,
  [settle('ram:ApplicableTradeTax', 'ram:TypeCode')]: breakdown,
  [settle('ram:ApplicableTradeTax', 'ram:CalculatedAmount')]: breakdownAt('taxAmount'),
  [settle('ram:ApplicableTradeTax', 'ram:BasisAmount')]: breakdownAt('taxableAmount'),
  [settle('ram:ApplicableTradeTax', 'ram:CategoryCode')]: breakdownAt('category'),
  [settle('ram:ApplicableTradeTax', 'ram:RateApplicablePercent')]: breakdownAt('rate'),
  [settle('ram:ApplicableTradeTax', 'ram:ExemptionReason')]: (idx, invoice) => breakdownExemptionPath(invoice, idx[3]! - 1, 'exemptionReason'),
  [settle('ram:ApplicableTradeTax', 'ram:ExemptionReasonCode')]: (idx, invoice) => breakdownExemptionPath(invoice, idx[3]! - 1, 'exemptionReasonCode'),

  // --- Totals (calculated: convention `totals.<field>` as in BR-CO-1x; input fields directly) --------------------------
  [settle('ram:SpecifiedTradeSettlementHeaderMonetarySummation', 'ram:LineTotalAmount')]: () => 'totals.lineTotal',
  [settle('ram:SpecifiedTradeSettlementHeaderMonetarySummation', 'ram:ChargeTotalAmount')]: () => 'totals.chargeTotal',
  [settle('ram:SpecifiedTradeSettlementHeaderMonetarySummation', 'ram:AllowanceTotalAmount')]: () => 'totals.allowanceTotal',
  [settle('ram:SpecifiedTradeSettlementHeaderMonetarySummation', 'ram:TaxBasisTotalAmount')]: () => 'totals.taxExclusiveAmount',
  [settle('ram:SpecifiedTradeSettlementHeaderMonetarySummation', 'ram:TaxTotalAmount')]: () => 'totals.taxTotal',
  [settle('ram:SpecifiedTradeSettlementHeaderMonetarySummation', 'ram:RoundingAmount')]: () => 'roundingAmount',
  [settle('ram:SpecifiedTradeSettlementHeaderMonetarySummation', 'ram:GrandTotalAmount')]: () => 'totals.taxInclusiveAmount',
  [settle('ram:SpecifiedTradeSettlementHeaderMonetarySummation', 'ram:TotalPrepaidAmount')]: () => 'prepaidAmount',
  [settle('ram:SpecifiedTradeSettlementHeaderMonetarySummation', 'ram:DuePayableAmount')]: () => 'totals.payableAmount',
};

/**
 * Maps a (simplified) SVRL `location` to an input path. `undefined` if the location lies outside
 * the known CII tree; the caller then uses the original XPath as `path`.
 */
export function mapSchematronLocation(location: string, invoice: CalculatedInvoice): string | undefined {
  const segments = parseSegments(location);
  if (segments === undefined) return undefined;
  for (let len = segments.length; len >= 1; len--) {
    const key = segments
      .slice(0, len)
      .map((s) => s.name)
      .join('/');
    const resolver = TABLE[key];
    if (resolver !== undefined) {
      return resolver(
        segments.slice(0, len).map((s) => s.index),
        invoice,
      );
    }
  }
  return undefined;
}
