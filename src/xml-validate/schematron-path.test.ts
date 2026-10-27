/**
 * `mapSchematronLocation`: maps the (already simplified) SVRL `location` of a Schematron finding
 * to an input path. All areas from the task are tested: header, seller, buyer,
 * indexed lines, indexed VAT breakdown, payment, delivery, totals, and the fallback (nearest
 * mappable parent path) for paths that cannot be mapped exactly (allowances/charges, unknown depth).
 */
import { describe, expect, it } from 'vitest';
import { calculate } from '../calculate/calculate.js';
import type { CalculatedInvoice } from '../model/calculated.js';
import type { InvoiceInput } from '../model/input.js';
import { normalize } from '../normalize/normalize.js';
import { mapSchematronLocation } from './schematron-path.js';

function calc(input: InvoiceInput): CalculatedInvoice {
  return calculate(normalize(input));
}

const FULL_INPUT: InvoiceInput = {
  profile: 'en16931',
  number: 'RE-2026-00099',
  issueDate: '2026-09-01',
  dueDate: '2026-09-15',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  buyerReference: 'LEIT-123',
  notes: ['Hinweis A', 'Hinweis B'],
  precedingInvoices: [
    { number: 'RE-2026-00001', issueDate: '2026-08-01' },
    { number: 'RE-2026-00002' },
  ],
  delivery: {
    date: '2026-08-15',
    address: { street: 'Lagerweg 1', city: 'Köln', postalCode: '50667', country: 'DE' },
    recipientName: 'Wareneingang',
  },
  seller: {
    name: 'Musterwerk GmbH',
    id: 'LIEF-1',
    tradingName: 'Musterwerk',
    legalRegistration: { id: 'HRB 12345', scheme: '0002' },
    address: { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' },
    taxNumber: '93815/08152',
    contact: { name: 'Erika Muster', phone: '+49 711 123456-0', email: 'rechnung@musterwerk.example' },
    electronicAddress: { scheme: 'EM', value: 'rechnung@musterwerk.example' },
  },
  buyer: {
    name: 'Beispiel & Söhne KG',
    orderReference: 'BEST-42',
    address: { street: 'Hauptstraße 1', street2: 'Hinterhaus', city: 'Berlin', postalCode: '10115', country: 'DE' },
    vatId: 'DE987654321',
  },
  payment: {
    means: 'transfer',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    accountHolder: 'Musterwerk GmbH',
    terms: 'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
    reference: 'RE-2026-00099',
    creditorId: 'DE98ZZZ09999999999',
    mandateReference: 'MANDAT-1',
    debitedIban: 'DE02120300000000202051',
  },
  lines: [
    {
      name: 'Fachbuch E-Rechnung',
      description: 'Taschenbuch',
      quantity: 2,
      unit: 'Stück',
      unitPrice: '39.90',
      vat: { category: 'S', rate: 7 },
    },
    {
      name: 'Schulung',
      quantity: 8,
      unit: 'Stunde',
      unitPrice: '120.00',
      priceBaseQuantity: 1,
      vat: { category: 'S', rate: 19 },
      allowances: [{ percent: 10, reason: 'Treuerabatt', reasonCode: '95' }],
      charges: [{ amount: '5.00', reason: 'Express', reasonCode: 'FC' }],
    },
  ],
  allowances: [{ percent: 5, reason: 'Rahmenvertragsrabatt', reasonCode: '95', vat: { category: 'S', rate: 19 } }],
  charges: [{ amount: '12.50', reason: 'Verpackung', reasonCode: 'PC', vat: { category: 'S', rate: 19 } }],
  prepaidAmount: '19.00',
  roundingAmount: '0.01',
};

const invoice = calc(FULL_INPUT);

// Second case: seller without a VAT identifier (tax number only); SpecifiedTaxRegistration[1] must
// then point to taxNumber, not vatId.
const NO_VAT_ID_INPUT: InvoiceInput = { ...FULL_INPUT, seller: { ...FULL_INPUT.seller, vatId: undefined, taxNumber: '93815/08152' } };
const invoiceNoVatId = calc(NO_VAT_ID_INPUT);

describe('mapSchematronLocation: header', () => {
  it('invoice number, type, invoice date, currency', () => {
    expect(mapSchematronLocation('/rsm:CrossIndustryInvoice[1]/rsm:ExchangedDocument[1]/ram:ID[1]', invoice)).toBe('number');
    expect(mapSchematronLocation('/rsm:CrossIndustryInvoice[1]/rsm:ExchangedDocument[1]/ram:TypeCode[1]', invoice)).toBe('type');
    expect(mapSchematronLocation('/rsm:CrossIndustryInvoice[1]/rsm:ExchangedDocument[1]/ram:IssueDateTime[1]/udt:DateTimeString[1]', invoice)).toBe('issueDate');
    expect(mapSchematronLocation('/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeSettlement[1]/ram:InvoiceCurrencyCode[1]', invoice)).toBe('currency');
  });

  it('profile identifier (Guideline/BusinessProcess)', () => {
    expect(mapSchematronLocation('/rsm:CrossIndustryInvoice[1]/rsm:ExchangedDocumentContext[1]/ram:GuidelineSpecifiedDocumentContextParameter[1]/ram:ID[1]', invoice)).toBe('profile');
    expect(mapSchematronLocation('/rsm:CrossIndustryInvoice[1]/rsm:ExchangedDocumentContext[1]/ram:BusinessProcessSpecifiedDocumentContextParameter[1]/ram:ID[1]', invoice)).toBe('profile');
  });

  it('note with index', () => {
    expect(mapSchematronLocation('/rsm:CrossIndustryInvoice[1]/rsm:ExchangedDocument[1]/ram:IncludedNote[2]/ram:Content[1]', invoice)).toBe('notes[1]');
  });

  it('buyer reference, due date, service period', () => {
    expect(mapSchematronLocation('/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeAgreement[1]/ram:BuyerReference[1]', invoice)).toBe('buyerReference');
    expect(
      mapSchematronLocation(
        '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeSettlement[1]/ram:SpecifiedTradePaymentTerms[1]/ram:DueDateDateTime[1]/udt:DateTimeString[1]',
        invoice,
      ),
    ).toBe('dueDate');
    expect(
      mapSchematronLocation('/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeSettlement[1]/ram:BillingSpecifiedPeriod[1]/ram:StartDateTime[1]/udt:DateTimeString[1]', invoice),
    ).toBe('periodStart');
    expect(
      mapSchematronLocation('/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeSettlement[1]/ram:BillingSpecifiedPeriod[1]/ram:EndDateTime[1]', invoice),
    ).toBe('periodEnd');
  });

  it('preceding invoice with index', () => {
    const p = '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeSettlement[1]/ram:InvoiceReferencedDocument[2]';
    expect(mapSchematronLocation(p, invoice)).toBe('precedingInvoices[1]');
    expect(mapSchematronLocation(`${p}/ram:IssuerAssignedID[1]`, invoice)).toBe('precedingInvoices[1].number');
    expect(mapSchematronLocation(`${p}/ram:FormattedIssueDateTime[1]/qdt:DateTimeString[1]`, invoice)).toBe('precedingInvoices[1].issueDate');
  });
});

describe('mapSchematronLocation: seller/buyer', () => {
  const SELLER = '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeAgreement[1]/ram:SellerTradeParty[1]';
  const BUYER = '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeAgreement[1]/ram:BuyerTradeParty[1]';

  it('name, identifier, register entry, trade name', () => {
    expect(mapSchematronLocation(`${SELLER}/ram:Name[1]`, invoice)).toBe('seller.name');
    expect(mapSchematronLocation(`${SELLER}/ram:ID[1]`, invoice)).toBe('seller.id');
    expect(mapSchematronLocation(`${SELLER}/ram:SpecifiedLegalOrganization[1]/ram:ID[1]`, invoice)).toBe('seller.legalRegistration.id');
    expect(mapSchematronLocation(`${SELLER}/ram:SpecifiedLegalOrganization[1]/ram:TradingBusinessName[1]`, invoice)).toBe('seller.tradingName');
  });

  it('contact', () => {
    expect(mapSchematronLocation(`${SELLER}/ram:DefinedTradeContact[1]/ram:PersonName[1]`, invoice)).toBe('seller.contact.name');
    expect(mapSchematronLocation(`${SELLER}/ram:DefinedTradeContact[1]/ram:TelephoneUniversalCommunication[1]/ram:CompleteNumber[1]`, invoice)).toBe('seller.contact.phone');
    expect(mapSchematronLocation(`${SELLER}/ram:DefinedTradeContact[1]/ram:EmailURIUniversalCommunication[1]/ram:URIID[1]`, invoice)).toBe('seller.contact.email');
  });

  it('address', () => {
    expect(mapSchematronLocation(`${SELLER}/ram:PostalTradeAddress[1]/ram:PostcodeCode[1]`, invoice)).toBe('seller.address.postalCode');
    expect(mapSchematronLocation(`${SELLER}/ram:PostalTradeAddress[1]/ram:LineOne[1]`, invoice)).toBe('seller.address.street');
    expect(mapSchematronLocation(`${BUYER}/ram:PostalTradeAddress[1]/ram:LineTwo[1]`, invoice)).toBe('buyer.address.street2');
    expect(mapSchematronLocation(`${BUYER}/ram:PostalTradeAddress[1]/ram:CityName[1]`, invoice)).toBe('buyer.address.city');
    expect(mapSchematronLocation(`${BUYER}/ram:PostalTradeAddress[1]/ram:CountryID[1]`, invoice)).toBe('buyer.address.country');
  });

  it('electronic address', () => {
    expect(mapSchematronLocation(`${SELLER}/ram:URIUniversalCommunication[1]/ram:URIID[1]`, invoice)).toBe('seller.electronicAddress.value');
  });

  it('VAT ID vs. tax number (order: vatId first, then taxNumber)', () => {
    // FULL_INPUT: seller has NO vatId, only taxNumber -> SpecifiedTaxRegistration[1] is the tax number.
    expect(mapSchematronLocation(`${SELLER}/ram:SpecifiedTaxRegistration[1]/ram:ID[1]`, invoiceNoVatId)).toBe('seller.taxNumber');
    // Buyer has only vatId -> SpecifiedTaxRegistration[1] is the VAT identifier.
    expect(mapSchematronLocation(`${BUYER}/ram:SpecifiedTaxRegistration[1]/ram:ID[1]`, invoice)).toBe('buyer.vatId');
  });

  it('order reference of the buyer', () => {
    expect(
      mapSchematronLocation(
        '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeAgreement[1]/ram:BuyerOrderReferencedDocument[1]/ram:IssuerAssignedID[1]',
        invoice,
      ),
    ).toBe('buyer.orderReference');
  });
});

describe('mapSchematronLocation: lines with index', () => {
  const LINE2 = '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:IncludedSupplyChainTradeLineItem[2]';

  it('name, quantity, price, tax category/rate (0-based input index)', () => {
    expect(mapSchematronLocation(`${LINE2}/ram:SpecifiedTradeProduct[1]/ram:Name[1]`, invoice)).toBe('lines[1].name');
    expect(mapSchematronLocation(`${LINE2}/ram:SpecifiedLineTradeDelivery[1]/ram:BilledQuantity[1]`, invoice)).toBe('lines[1].quantity');
    expect(mapSchematronLocation(`${LINE2}/ram:SpecifiedLineTradeAgreement[1]/ram:NetPriceProductTradePrice[1]/ram:ChargeAmount[1]`, invoice)).toBe('lines[1].unitPrice');
    expect(mapSchematronLocation(`${LINE2}/ram:SpecifiedLineTradeSettlement[1]/ram:ApplicableTradeTax[1]/ram:CategoryCode[1]`, invoice)).toBe('lines[1].vat.category');
    expect(mapSchematronLocation(`${LINE2}/ram:SpecifiedLineTradeSettlement[1]/ram:ApplicableTradeTax[1]/ram:RateApplicablePercent[1]`, invoice)).toBe('lines[1].vat.rate');
  });

  it('line allowance and charge (order: allowances first, then charges)', () => {
    const base = `${LINE2}/ram:SpecifiedLineTradeSettlement[1]/ram:SpecifiedTradeAllowanceCharge`;
    expect(mapSchematronLocation(`${base}[1]/ram:CalculationPercent[1]`, invoice)).toBe('lines[1].allowances[0].percent');
    expect(mapSchematronLocation(`${base}[1]/ram:Reason[1]`, invoice)).toBe('lines[1].allowances[0].reason');
    expect(mapSchematronLocation(`${base}[2]/ram:ActualAmount[1]`, invoice)).toBe('lines[1].charges[0].amount');
    expect(mapSchematronLocation(`${base}[2]/ram:ReasonCode[1]`, invoice)).toBe('lines[1].charges[0].reasonCode');
  });

  it('fallback: line net total (calculated, not an input field) → the line itself', () => {
    expect(
      mapSchematronLocation(`${LINE2}/ram:SpecifiedLineTradeSettlement[1]/ram:SpecifiedTradeSettlementLineMonetarySummation[1]/ram:LineTotalAmount[1]`, invoice),
    ).toBe('lines[1]');
  });
});

describe('mapSchematronLocation: VAT breakdown with index', () => {
  const SETTLE = '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeSettlement[1]';

  it('taxable amount and tax amount per breakdown', () => {
    const idx = invoice.vatBreakdown.findIndex((b) => b.category === 'S' && b.rate.eq(19));
    expect(idx).toBeGreaterThanOrEqual(0);
    const n = idx + 1;
    expect(mapSchematronLocation(`${SETTLE}/ram:ApplicableTradeTax[${String(n)}]/ram:BasisAmount[1]`, invoice)).toBe(`vatBreakdown[${String(idx)}].taxableAmount`);
    expect(mapSchematronLocation(`${SETTLE}/ram:ApplicableTradeTax[${String(n)}]/ram:CalculatedAmount[1]`, invoice)).toBe(`vatBreakdown[${String(idx)}].taxAmount`);
    expect(mapSchematronLocation(`${SETTLE}/ram:ApplicableTradeTax[${String(n)}]/ram:CategoryCode[1]`, invoice)).toBe(`vatBreakdown[${String(idx)}].category`);
  });
});

describe('mapSchematronLocation: payment', () => {
  const MEANS = '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeSettlement[1]/ram:SpecifiedTradeSettlementPaymentMeans[1]';

  it('payment means, IBAN (seller/buyer), BIC, account holder', () => {
    expect(mapSchematronLocation(`${MEANS}/ram:TypeCode[1]`, invoice)).toBe('payment.means');
    expect(mapSchematronLocation(`${MEANS}/ram:PayeePartyCreditorFinancialAccount[1]/ram:IBANID[1]`, invoice)).toBe('payment.iban');
    expect(mapSchematronLocation(`${MEANS}/ram:PayeePartyCreditorFinancialAccount[1]/ram:AccountName[1]`, invoice)).toBe('payment.accountHolder');
    expect(mapSchematronLocation(`${MEANS}/ram:PayerPartyDebtorFinancialAccount[1]/ram:IBANID[1]`, invoice)).toBe('payment.debitedIban');
    expect(mapSchematronLocation(`${MEANS}/ram:PayeeSpecifiedCreditorFinancialInstitution[1]/ram:BICID[1]`, invoice)).toBe('payment.bic');
  });

  it('mandate reference, creditor ID, payment reference, terms', () => {
    const settle = '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeSettlement[1]';
    expect(mapSchematronLocation(`${settle}/ram:SpecifiedTradePaymentTerms[1]/ram:DirectDebitMandateID[1]`, invoice)).toBe('payment.mandateReference');
    expect(mapSchematronLocation(`${settle}/ram:CreditorReferenceID[1]`, invoice)).toBe('payment.creditorId');
    expect(mapSchematronLocation(`${settle}/ram:PaymentReference[1]`, invoice)).toBe('payment.reference');
    expect(mapSchematronLocation(`${settle}/ram:SpecifiedTradePaymentTerms[1]/ram:Description[1]`, invoice)).toBe('payment.terms');
  });

  it('document allowance/charge (order: allowances first, then charges)', () => {
    const base = '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeSettlement[1]/ram:SpecifiedTradeAllowanceCharge';
    expect(mapSchematronLocation(`${base}[1]/ram:Reason[1]`, invoice)).toBe('allowances[0].reason');
    expect(mapSchematronLocation(`${base}[1]/ram:CategoryTradeTax[1]/ram:CategoryCode[1]`, invoice)).toBe('allowances[0].vat.category');
    expect(mapSchematronLocation(`${base}[2]/ram:ActualAmount[1]`, invoice)).toBe('charges[0].amount');
  });
});

describe('mapSchematronLocation: delivery', () => {
  const DELIVERY = '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeDelivery[1]';

  it('recipient, address, date', () => {
    expect(mapSchematronLocation(`${DELIVERY}/ram:ShipToTradeParty[1]/ram:Name[1]`, invoice)).toBe('delivery.recipientName');
    expect(mapSchematronLocation(`${DELIVERY}/ram:ShipToTradeParty[1]/ram:PostalTradeAddress[1]/ram:PostcodeCode[1]`, invoice)).toBe('delivery.address.postalCode');
    expect(mapSchematronLocation(`${DELIVERY}/ram:ActualDeliverySupplyChainEvent[1]/ram:OccurrenceDateTime[1]/udt:DateTimeString[1]`, invoice)).toBe('delivery.date');
  });

  it('fallback: empty ApplicableHeaderTradeDelivery (PEPPOL-EN16931-R008) → delivery', () => {
    expect(mapSchematronLocation(DELIVERY, invoice)).toBe('delivery');
  });
});

describe('mapSchematronLocation: totals', () => {
  const SUMMATION =
    '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeSettlement[1]/ram:SpecifiedTradeSettlementHeaderMonetarySummation[1]';

  it('calculated totals (fallback convention totals.<field>, as in BR-CO-1x) and input fields (rounding/prepayment)', () => {
    expect(mapSchematronLocation(`${SUMMATION}/ram:LineTotalAmount[1]`, invoice)).toBe('totals.lineTotal');
    expect(mapSchematronLocation(`${SUMMATION}/ram:TaxBasisTotalAmount[1]`, invoice)).toBe('totals.taxExclusiveAmount');
    expect(mapSchematronLocation(`${SUMMATION}/ram:GrandTotalAmount[1]`, invoice)).toBe('totals.taxInclusiveAmount');
    expect(mapSchematronLocation(`${SUMMATION}/ram:DuePayableAmount[1]`, invoice)).toBe('totals.payableAmount');
    expect(mapSchematronLocation(`${SUMMATION}/ram:RoundingAmount[1]`, invoice)).toBe('roundingAmount');
    expect(mapSchematronLocation(`${SUMMATION}/ram:TotalPrepaidAmount[1]`, invoice)).toBe('prepaidAmount');
  });
});

describe('mapSchematronLocation: not mappable', () => {
  it('returns undefined for paths outside the known CII tree (the caller then uses the original XPath)', () => {
    expect(mapSchematronLocation('/rsm:CrossIndustryInvoice[1]', invoice)).toBeUndefined();
    expect(mapSchematronLocation("/*:X[namespace-uri()='urn:other'][1]/@id", invoice)).toBeUndefined();
  });
});
