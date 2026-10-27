/**
 * CII serialization (UN/CEFACT Cross Industry Invoice D16B) for Factur-X/ZUGFeRD BASIC, EN 16931,
 * EXTENDED, and XRechnung.
 *
 * Pure and deterministic: the same `CalculatedInvoice` -> byte-identical XML. No `new Date()`, no
 * random values.
 *
 * **Element order** is exactly that of the Factur-X XSDs 1.09.2
 * (`the Factur-X XSD for the profile, ReusableAggregateBusinessInformationEntity`); the comments on the containers name
 * the respective XSD sequence. This is the main source of errors with CII, so do not guess,
 * derive it from the XSD.
 *
 * **Profile filter (BASIC):** elements unknown to the BASIC XSD are omitted: `DefinedTradeContact`,
 * `SpecifiedTradeProduct/Description`, `PayeeSpecifiedCreditorFinancialInstitution` (BIC), `AccountName`,
 * `RoundingAmount`, line level `CalculationPercent`/`BasisAmount`, buyer `TradingBusinessName`.
 * Semantic validation reports this beforehand (IF-WARN-012…014, IF-PROFILE-001/002).
 *
 * **Numbers:** amounts (BT-1xx) with exactly 2 decimal places; unit price (BT-146) with 2-4
 * decimal places without trailing zeros; quantities and rates as calculated/entered in canonical
 * decimal notation (`Decimal.toString()`, no exponent). Negative zero is written as `0.00`.
 *
 * **Category O:** no `RateApplicablePercent` at the line and allowance/charge level
 * (BR-O-05/06/07); in the breakdown only for XRechnung (BR-DE-14 always requires BT-119),
 * otherwise omitted (BR-48 allows this for O).
 *
 * **Dates:** always `udt:DateTimeString format="102"` (YYYYMMDD), BT-26 as `qdt:DateTimeString`.
 */
import { toFixed2, toFixedUpTo, type Decimal } from '../../money/index.js';
import type { CalculatedDocumentAllowanceCharge, CalculatedInvoice, CalculatedLine, CalculatedLineAllowanceCharge, VatBreakdownEntry } from '../../model/calculated.js';
import type { Profile } from '../../model/input.js';
import type { NormalizedAddress, NormalizedParty, NormalizedVat } from '../../model/normalized.js';
import { el, render, text, type XmlChild, type XmlElement } from '../xml-builder.js';

export const CII_NAMESPACES: Readonly<Record<string, string>> = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
};

/** BT-23 business process, mandatory for XRechnung (PEPPOL-EN16931-R001). */
export const XRECHNUNG_BUSINESS_PROCESS = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

/** Amount with exactly 2 decimal places; `-0` -> `0.00`. */
export function fmtAmount(value: Decimal): string {
  return value.isZero() ? '0.00' : toFixed2(value);
}

/** Unit price: 2 to 4 decimal places. */
export function fmtPrice(value: Decimal): string {
  return value.isZero() ? '0.00' : toFixedUpTo(value, 4);
}

/** Quantity/rate: canonical decimal notation without exponent, `-0` -> `0`. */
export function fmtNumber(value: Decimal): string {
  return value.isZero() ? '0' : value.toString();
}

/** ISO date `YYYY-MM-DD` -> format 102 `YYYYMMDD`. */
export function fmtDate102(iso: string): string {
  return iso.replace(/-/g, '');
}

interface Ctx {
  profile: Profile;
  basic: boolean;
  xrechnung: boolean;
  currency: string;
}

function dateTime(name: string, iso: string | undefined): XmlElement | undefined {
  if (iso === undefined) return undefined;
  return el(name, [text('udt:DateTimeString', fmtDate102(iso), { format: '102' })]);
}

/** ram:TradeAddressType: PostcodeCode, LineOne, LineTwo, LineThree, CityName, CountryID, CountrySubDivisionName */
function postalAddress(a: NormalizedAddress): XmlElement {
  return el('ram:PostalTradeAddress', [
    text('ram:PostcodeCode', a.postalCode),
    text('ram:LineOne', a.street),
    text('ram:LineTwo', a.street2),
    text('ram:CityName', a.city),
    text('ram:CountryID', a.country),
  ]);
}

/**
 * ram:TradePartyType: ID, GlobalID, Name, Description, SpecifiedLegalOrganization, DefinedTradeContact,
 * PostalTradeAddress, URIUniversalCommunication, SpecifiedTaxRegistration (0..2)
 */
function tradeParty(name: string, p: NormalizedParty, ctx: Ctx, role: 'seller' | 'buyer'): XmlElement {
  const lr = p.legalRegistration;
  const contact = p.contact;
  // Buyer TradingBusinessName is "not used" in the BASIC profile.
  const tradingName = ctx.basic && role === 'buyer' ? undefined : p.tradingName;
  return el(name, [
    text('ram:ID', p.id),
    text('ram:Name', p.name),
    el('ram:SpecifiedLegalOrganization', [
      lr === undefined ? undefined : text('ram:ID', lr.id, { schemeID: lr.scheme }),
      text('ram:TradingBusinessName', tradingName),
    ]),
    ctx.basic || contact === undefined
      ? undefined
      : el('ram:DefinedTradeContact', [
          text('ram:PersonName', contact.name),
          el('ram:TelephoneUniversalCommunication', [text('ram:CompleteNumber', contact.phone)]),
          el('ram:EmailURIUniversalCommunication', [text('ram:URIID', contact.email)]),
        ]),
    postalAddress(p.address),
    p.electronicAddress === undefined
      ? undefined
      : el('ram:URIUniversalCommunication', [text('ram:URIID', p.electronicAddress.value, { schemeID: p.electronicAddress.scheme })]),
    p.vatId === undefined ? undefined : el('ram:SpecifiedTaxRegistration', [text('ram:ID', p.vatId, { schemeID: 'VA' })]),
    p.taxNumber === undefined ? undefined : el('ram:SpecifiedTaxRegistration', [text('ram:ID', p.taxNumber, { schemeID: 'FC' })]),
  ]);
}

/** BT-119/BT-152: category O without a rate (except in the breakdown for XRechnung). */
function ratePercent(vat: NormalizedVat, ctx: Ctx, level: 'line' | 'allowance' | 'breakdown'): XmlElement | undefined {
  if (vat.category === 'O' && !(level === 'breakdown' && ctx.xrechnung)) return undefined;
  return text('ram:RateApplicablePercent', fmtNumber(vat.rate));
}

/**
 * ram:TradeAllowanceChargeType: ChargeIndicator, CalculationPercent, BasisAmount, ActualAmount, ReasonCode, Reason, CategoryTradeTax
 */
function allowanceCharge(
  ac: CalculatedLineAllowanceCharge,
  charge: boolean,
  baseAmount: Decimal,
  ctx: Ctx,
  categoryTax: NormalizedVat | undefined,
  level: 'line' | 'document',
): XmlElement {
  const percent = ac.value.kind === 'percent' && !(level === 'line' && ctx.basic) ? ac.value.percent : undefined;
  return el('ram:SpecifiedTradeAllowanceCharge', [
    el('ram:ChargeIndicator', [text('udt:Indicator', charge ? 'true' : 'false')]),
    percent === undefined ? undefined : text('ram:CalculationPercent', fmtNumber(percent)),
    percent === undefined ? undefined : text('ram:BasisAmount', fmtAmount(baseAmount)),
    text('ram:ActualAmount', fmtAmount(ac.amount)),
    text('ram:ReasonCode', ac.reasonCode),
    text('ram:Reason', ac.reason),
    categoryTax === undefined
      ? undefined
      : el('ram:CategoryTradeTax', [
          text('ram:TypeCode', 'VAT'),
          text('ram:CategoryCode', categoryTax.category),
          ratePercent(categoryTax, ctx, 'allowance'),
        ]),
  ]);
}

/**
 * ram:SupplyChainTradeLineItemType: AssociatedDocumentLineDocument, SpecifiedTradeProduct, SpecifiedLineTradeAgreement,
 * SpecifiedLineTradeDelivery, SpecifiedLineTradeSettlement
 */
function lineItem(line: CalculatedLine, ctx: Ctx): XmlElement {
  const basisQuantity = line.priceBaseQuantity.eq(1) ? undefined : line.priceBaseQuantity;
  const lineBase = line.grossAmount.toDecimalPlaces(2);
  return el('ram:IncludedSupplyChainTradeLineItem', [
    el('ram:AssociatedDocumentLineDocument', [text('ram:LineID', line.id)]),
    // TradeProductType: GlobalID, SellerAssignedID, BuyerAssignedID, Name, Description, …
    el('ram:SpecifiedTradeProduct', [text('ram:Name', line.name), ctx.basic ? undefined : text('ram:Description', line.description)]),
    // LineTradeAgreementType: BuyerOrderReferencedDocument, GrossPriceProductTradePrice, NetPriceProductTradePrice
    el('ram:SpecifiedLineTradeAgreement', [
      // TradePriceType: ChargeAmount, BasisQuantity, AppliedTradeAllowanceCharge
      el('ram:NetPriceProductTradePrice', [
        text('ram:ChargeAmount', fmtPrice(line.unitPrice)),
        basisQuantity === undefined ? undefined : text('ram:BasisQuantity', fmtNumber(basisQuantity), { unitCode: line.unitCode }),
      ]),
    ]),
    el('ram:SpecifiedLineTradeDelivery', [text('ram:BilledQuantity', fmtNumber(line.quantity), { unitCode: line.unitCode })]),
    // LineTradeSettlementType: ApplicableTradeTax, BillingSpecifiedPeriod, SpecifiedTradeAllowanceCharge, SpecifiedTradeSettlementLineMonetarySummation
    el('ram:SpecifiedLineTradeSettlement', [
      // TradeTaxType: CalculatedAmount, TypeCode, ExemptionReason, BasisAmount, CategoryCode, ExemptionReasonCode, TaxPointDate, DueDateTypeCode, RateApplicablePercent
      el('ram:ApplicableTradeTax', [text('ram:TypeCode', 'VAT'), text('ram:CategoryCode', line.vat.category), ratePercent(line.vat, ctx, 'line')]),
      ...line.allowances.map((ac) => allowanceCharge(ac, false, lineBase, ctx, undefined, 'line')),
      ...line.charges.map((ac) => allowanceCharge(ac, true, lineBase, ctx, undefined, 'line')),
      el('ram:SpecifiedTradeSettlementLineMonetarySummation', [text('ram:LineTotalAmount', fmtAmount(line.netAmount))]),
    ]),
  ]);
}

/** BT-120/BT-121 per breakdown group: the first item (line, allowance, charge) of the same (category, rate) with a VAT exemption reason. */
function exemptionFor(invoice: CalculatedInvoice, b: VatBreakdownEntry): { reason?: string; code?: string } {
  const candidates: NormalizedVat[] = [...invoice.lines.map((l) => l.vat), ...invoice.allowances.map((a) => a.vat), ...invoice.charges.map((c) => c.vat)];
  for (const v of candidates) {
    if (v.category === b.category && v.rate.eq(b.rate) && (v.exemptionReason !== undefined || v.exemptionReasonCode !== undefined)) {
      const out: { reason?: string; code?: string } = {};
      if (v.exemptionReason !== undefined) out.reason = v.exemptionReason;
      if (v.exemptionReasonCode !== undefined) out.code = v.exemptionReasonCode;
      return out;
    }
  }
  return {};
}

/** ram:TradeTaxType (header breakdown BG-23) */
function breakdown(invoice: CalculatedInvoice, b: VatBreakdownEntry, ctx: Ctx): XmlElement {
  const ex = exemptionFor(invoice, b);
  return el('ram:ApplicableTradeTax', [
    text('ram:CalculatedAmount', fmtAmount(b.taxAmount)),
    text('ram:TypeCode', 'VAT'),
    text('ram:ExemptionReason', ex.reason),
    text('ram:BasisAmount', fmtAmount(b.taxableAmount)),
    text('ram:CategoryCode', b.category),
    text('ram:ExemptionReasonCode', ex.code),
    ratePercent({ category: b.category, rate: b.rate }, ctx, 'breakdown'),
  ]);
}

/** ram:TradeSettlementPaymentMeansType: TypeCode, Information, …FinancialCard, PayerPartyDebtorFinancialAccount, PayeePartyCreditorFinancialAccount, PayeeSpecifiedCreditorFinancialInstitution */
function paymentMeans(invoice: CalculatedInvoice, ctx: Ctx): XmlElement | undefined {
  const p = invoice.payment;
  if (p === undefined) return undefined;
  return el('ram:SpecifiedTradeSettlementPaymentMeans', [
    text('ram:TypeCode', p.meansCode),
    p.debitedIban === undefined ? undefined : el('ram:PayerPartyDebtorFinancialAccount', [text('ram:IBANID', p.debitedIban)]),
    p.iban === undefined
      ? undefined
      : el('ram:PayeePartyCreditorFinancialAccount', [text('ram:IBANID', p.iban), ctx.basic ? undefined : text('ram:AccountName', p.accountHolder)]),
    ctx.basic || p.bic === undefined ? undefined : el('ram:PayeeSpecifiedCreditorFinancialInstitution', [text('ram:BICID', p.bic)]),
  ]);
}

function documentAllowanceCharges(invoice: CalculatedInvoice, ctx: Ctx): XmlChild[] {
  const one = (ac: CalculatedDocumentAllowanceCharge, charge: boolean): XmlElement => allowanceCharge(ac, charge, ac.baseAmount, ctx, ac.vat, 'document');
  return [...invoice.allowances.map((a) => one(a, false)), ...invoice.charges.map((c) => one(c, true))];
}

/**
 * ram:TradeSettlementHeaderMonetarySummationType: LineTotalAmount, ChargeTotalAmount, AllowanceTotalAmount, TaxBasisTotalAmount,
 * TaxTotalAmount, RoundingAmount, GrandTotalAmount, TotalPrepaidAmount, DuePayableAmount
 */
function monetarySummation(invoice: CalculatedInvoice, ctx: Ctx): XmlElement {
  const t = invoice.totals;
  const hasCharges = invoice.charges.length > 0 || !t.chargeTotal.isZero();
  const hasAllowances = invoice.allowances.length > 0 || !t.allowanceTotal.isZero();
  return el('ram:SpecifiedTradeSettlementHeaderMonetarySummation', [
    text('ram:LineTotalAmount', fmtAmount(t.lineTotal)),
    hasCharges ? text('ram:ChargeTotalAmount', fmtAmount(t.chargeTotal)) : undefined,
    hasAllowances ? text('ram:AllowanceTotalAmount', fmtAmount(t.allowanceTotal)) : undefined,
    text('ram:TaxBasisTotalAmount', fmtAmount(t.taxExclusiveAmount)),
    text('ram:TaxTotalAmount', fmtAmount(t.taxTotal), { currencyID: ctx.currency }),
    ctx.basic || t.roundingAmount.isZero() ? undefined : text('ram:RoundingAmount', fmtAmount(t.roundingAmount)),
    text('ram:GrandTotalAmount', fmtAmount(t.taxInclusiveAmount)),
    t.prepaidAmount.isZero() ? undefined : text('ram:TotalPrepaidAmount', fmtAmount(t.prepaidAmount)),
    text('ram:DuePayableAmount', fmtAmount(t.payableAmount)),
  ]);
}

/**
 * ram:HeaderTradeSettlementType: CreditorReferenceID, PaymentReference, TaxCurrencyCode, InvoiceCurrencyCode, PayeeTradeParty,
 * SpecifiedTradeSettlementPaymentMeans, ApplicableTradeTax, BillingSpecifiedPeriod, SpecifiedTradeAllowanceCharge,
 * SpecifiedTradePaymentTerms, SpecifiedTradeSettlementHeaderMonetarySummation, InvoiceReferencedDocument, ReceivableSpecifiedTradeAccountingAccount
 */
function headerSettlement(invoice: CalculatedInvoice, ctx: Ctx): XmlElement {
  const p = invoice.payment;
  return el('ram:ApplicableHeaderTradeSettlement', [
    text('ram:CreditorReferenceID', p?.creditorId),
    text('ram:PaymentReference', p?.reference),
    text('ram:InvoiceCurrencyCode', invoice.currency),
    paymentMeans(invoice, ctx),
    ...invoice.vatBreakdown.map((b) => breakdown(invoice, b, ctx)),
    el('ram:BillingSpecifiedPeriod', [dateTime('ram:StartDateTime', invoice.periodStart), dateTime('ram:EndDateTime', invoice.periodEnd)]),
    ...documentAllowanceCharges(invoice, ctx),
    // TradePaymentTermsType: Description, DueDateDateTime, DirectDebitMandateID
    el('ram:SpecifiedTradePaymentTerms', [
      text('ram:Description', p?.terms),
      dateTime('ram:DueDateDateTime', invoice.dueDate),
      text('ram:DirectDebitMandateID', p?.mandateReference),
    ]),
    monetarySummation(invoice, ctx),
    ...invoice.precedingInvoices.map((pi) =>
      // ReferencedDocumentType: IssuerAssignedID, …, FormattedIssueDateTime
      el('ram:InvoiceReferencedDocument', [
        text('ram:IssuerAssignedID', pi.number),
        pi.issueDate === undefined ? undefined : el('ram:FormattedIssueDateTime', [text('qdt:DateTimeString', fmtDate102(pi.issueDate), { format: '102' })]),
      ]),
    ),
  ]);
}

/** ram:HeaderTradeDeliveryType: ShipToTradeParty, ActualDeliverySupplyChainEvent, ...; mandatory per the XSD, so written even when empty. */
function headerDelivery(invoice: CalculatedInvoice): XmlElement {
  const d = invoice.delivery;
  return el(
    'ram:ApplicableHeaderTradeDelivery',
    [
      d?.address === undefined && d?.recipientName === undefined
        ? undefined
        : el('ram:ShipToTradeParty', [text('ram:Name', d.recipientName), d.address === undefined ? undefined : postalAddress(d.address)]),
      d?.date === undefined ? undefined : el('ram:ActualDeliverySupplyChainEvent', [dateTime('ram:OccurrenceDateTime', d.date)]),
    ],
    { keepEmpty: true },
  );
}

/** ram:HeaderTradeAgreementType: BuyerReference, SellerTradeParty, BuyerTradeParty, SellerTaxRepresentativeTradeParty, SellerOrderReferencedDocument, BuyerOrderReferencedDocument, … */
function headerAgreement(invoice: CalculatedInvoice, ctx: Ctx): XmlElement {
  return el('ram:ApplicableHeaderTradeAgreement', [
    text('ram:BuyerReference', invoice.buyerReference),
    tradeParty('ram:SellerTradeParty', invoice.seller, ctx, 'seller'),
    tradeParty('ram:BuyerTradeParty', invoice.buyer, ctx, 'buyer'),
    invoice.buyer.orderReference === undefined ? undefined : el('ram:BuyerOrderReferencedDocument', [text('ram:IssuerAssignedID', invoice.buyer.orderReference)]),
  ]);
}

export function buildCiiDocument(invoice: CalculatedInvoice): XmlElement {
  const ctx: Ctx = { profile: invoice.profile, basic: invoice.profile === 'basic', xrechnung: invoice.profile === 'xrechnung', currency: invoice.currency };
  return el('rsm:CrossIndustryInvoice', [
    // ExchangedDocumentContextType: BusinessProcessSpecifiedDocumentContextParameter, GuidelineSpecifiedDocumentContextParameter
    el('rsm:ExchangedDocumentContext', [
      ctx.xrechnung ? el('ram:BusinessProcessSpecifiedDocumentContextParameter', [text('ram:ID', XRECHNUNG_BUSINESS_PROCESS)]) : undefined,
      el('ram:GuidelineSpecifiedDocumentContextParameter', [text('ram:ID', invoice.profileUrn)]),
    ]),
    // ExchangedDocumentType: ID, TypeCode, IssueDateTime, IncludedNote
    el('rsm:ExchangedDocument', [
      text('ram:ID', invoice.number),
      text('ram:TypeCode', invoice.typeCode),
      dateTime('ram:IssueDateTime', invoice.issueDate),
      ...invoice.notes.map((n) => el('ram:IncludedNote', [text('ram:Content', n)])),
    ]),
    // SupplyChainTradeTransactionType: IncludedSupplyChainTradeLineItem+, ApplicableHeaderTradeAgreement, ApplicableHeaderTradeDelivery, ApplicableHeaderTradeSettlement
    el('rsm:SupplyChainTradeTransaction', [
      ...invoice.lines.map((l) => lineItem(l, ctx)),
      headerAgreement(invoice, ctx),
      headerDelivery(invoice),
      headerSettlement(invoice, ctx),
    ]),
  ]);
}

/** Serializes a calculated invoice as CII XML (UTF-8, with an XML declaration). */
export function serializeCii(invoice: CalculatedInvoice): string {
  return render(buildCiiDocument(invoice), CII_NAMESPACES);
}
