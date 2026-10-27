/**
 * Example corpus: official CII instances (see SOURCE.md) and helper functions for the corpus tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SaxonJS from 'saxon-js';
import type { Profile } from '../../src/index.js';

export const CORPUS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CORPUS_SOURCES = ['en16931', 'mustangproject', 'xrechnung-testsuite'] as const;

export interface CorpusFile {
  /** e.g. `xrechnung-testsuite/01.01a-INVOICE_uncefact.xml` */
  id: string;
  path: string;
  xml: string;
  profile: Profile;
}

const NS = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
};

/** Profile from BT-24 (GuidelineSpecifiedDocumentContextParameter/ID). */
export function profileOfXml(xml: string): Profile {
  const m = /GuidelineSpecifiedDocumentContextParameter>\s*<ram:ID>([^<]+)</.exec(xml);
  const urn = m?.[1]?.trim() ?? '';
  if (urn.includes('xrechnung')) return 'xrechnung';
  if (urn.endsWith(':basic')) return 'basic';
  if (urn.endsWith(':extended')) return 'extended';
  if (urn === 'urn:cen.eu:en16931:2017') return 'en16931';
  throw new Error(`Unbekannte Spezifikationskennung: ${urn}`);
}

export function loadCorpus(): CorpusFile[] {
  const out: CorpusFile[] = [];
  for (const source of CORPUS_SOURCES) {
    const dir = path.join(CORPUS_DIR, source);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xml')).sort()) {
      const xml = fs.readFileSync(path.join(dir, f), 'utf8');
      out.push({ id: `${source}/${f}`, path: path.join(dir, f), xml, profile: profileOfXml(xml) });
    }
  }
  return out;
}

/** Business-relevant values of a CII invoice, independent of element order, whitespace and number format. */
export interface BusinessValues {
  profileUrn: string;
  typeCode: string;
  currency: string;
  buyerReference: string | null;
  lineCount: number;
  lines: { id: string; quantity: number; unitCode: string; netPrice: number; lineTotal: number; category: string; rate: number | null }[];
  vatBreakdown: { category: string; rate: number | null; basis: number; tax: number }[];
  documentAllowances: number[];
  documentCharges: number[];
  totals: { lineTotal: number; allowanceTotal: number; chargeTotal: number; taxBasis: number; taxTotal: number; grandTotal: number; prepaid: number; rounding: number; duePayable: number };
  paymentMeansCode: string | null;
  precedingInvoices: string[];
  exemptionReasons: string[];
}

export async function parseXml(xml: string): Promise<unknown> {
  return SaxonJS.getResource({ text: xml, type: 'xml' });
}

function evalStr(node: unknown, xpath: string): string | null {
  const v = SaxonJS.XPath.evaluate(`string(${xpath})`, node, { namespaceContext: NS }) as string;
  return v === '' ? null : v.trim();
}
function evalNum(node: unknown, xpath: string, fallback = 0): number {
  const s = evalStr(node, xpath);
  return s === null ? fallback : Number(s);
}
function evalNodes(node: unknown, xpath: string): unknown[] {
  return SaxonJS.XPath.evaluate(xpath, node, { namespaceContext: NS, resultForm: 'array' }) as unknown[];
}

export function extractBusinessValues(doc: unknown): BusinessValues {
  const root = '/rsm:CrossIndustryInvoice';
  const settlement = `${root}/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement`;
  const sums = `${settlement}/ram:SpecifiedTradeSettlementHeaderMonetarySummation`;
  const rate = (n: unknown, xp: string): number | null => (evalStr(n, xp) === null ? null : evalNum(n, xp));
  return {
    profileUrn: evalStr(doc, `${root}/rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID`) ?? '',
    typeCode: evalStr(doc, `${root}/rsm:ExchangedDocument/ram:TypeCode`) ?? '',
    currency: evalStr(doc, `${settlement}/ram:InvoiceCurrencyCode`) ?? '',
    buyerReference: evalStr(doc, `${root}/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerReference`),
    lineCount: evalNodes(doc, `${root}/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem`).length,
    lines: evalNodes(doc, `${root}/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem`).map((l) => ({
      id: evalStr(l, 'ram:AssociatedDocumentLineDocument/ram:LineID') ?? '',
      quantity: evalNum(l, 'ram:SpecifiedLineTradeDelivery/ram:BilledQuantity'),
      unitCode: evalStr(l, 'ram:SpecifiedLineTradeDelivery/ram:BilledQuantity/@unitCode') ?? '',
      netPrice: evalNum(l, 'ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount'),
      lineTotal: evalNum(l, 'ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount'),
      category: evalStr(l, 'ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode') ?? '',
      rate: rate(l, 'ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent'),
    })),
    vatBreakdown: evalNodes(doc, `${settlement}/ram:ApplicableTradeTax`)
      .map((t) => ({
        category: evalStr(t, 'ram:CategoryCode') ?? '',
        rate: rate(t, 'ram:RateApplicablePercent'),
        basis: evalNum(t, 'ram:BasisAmount'),
        tax: evalNum(t, 'ram:CalculatedAmount'),
      }))
      .sort((a, b) => a.category.localeCompare(b.category) || (a.rate ?? 0) - (b.rate ?? 0)),
    documentAllowances: evalNodes(doc, `${settlement}/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator='false']`).map((a) => evalNum(a, 'ram:ActualAmount')).sort(),
    documentCharges: evalNodes(doc, `${settlement}/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator='true']`).map((a) => evalNum(a, 'ram:ActualAmount')).sort(),
    totals: {
      lineTotal: evalNum(doc, `${sums}/ram:LineTotalAmount`),
      allowanceTotal: evalNum(doc, `${sums}/ram:AllowanceTotalAmount`),
      chargeTotal: evalNum(doc, `${sums}/ram:ChargeTotalAmount`),
      taxBasis: evalNum(doc, `${sums}/ram:TaxBasisTotalAmount`),
      taxTotal: evalNum(doc, `${sums}/ram:TaxTotalAmount[1]`),
      grandTotal: evalNum(doc, `${sums}/ram:GrandTotalAmount`),
      prepaid: evalNum(doc, `${sums}/ram:TotalPrepaidAmount`),
      rounding: evalNum(doc, `${sums}/ram:RoundingAmount`),
      duePayable: evalNum(doc, `${sums}/ram:DuePayableAmount`),
    },
    paymentMeansCode: evalStr(doc, `${settlement}/ram:SpecifiedTradeSettlementPaymentMeans[1]/ram:TypeCode`),
    precedingInvoices: evalNodes(doc, `${settlement}/ram:InvoiceReferencedDocument`).map((d) => evalStr(d, 'ram:IssuerAssignedID') ?? ''),
    exemptionReasons: evalNodes(doc, `${settlement}/ram:ApplicableTradeTax/ram:ExemptionReason`).map((n) => evalStr(n, '.') ?? '').sort(),
  };
}
