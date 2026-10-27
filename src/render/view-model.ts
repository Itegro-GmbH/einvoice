/**
 * Render model: everything the templates display, fully formatted and with texts from `i18n/<locale>.ts`.
 * Templates contain no business logic and no text, only layout.
 */
import type { CalculatedDocumentAllowanceCharge, CalculatedInvoice, CalculatedLineAllowanceCharge, VatBreakdownEntry } from '../model/calculated.js';
import type { NormalizedAddress, NormalizedParty, NormalizedPayment } from '../model/normalized.js';
import { D, type Decimal } from '../money/index.js';
import { fill, fmtDate, fmtIban, fmtMoney, fmtPercent, fmtQuantity, unitName } from './format.js';
import { de, type Texts } from './i18n/de.js';

export type Locale = 'de';

export interface ViewModelOptions {
  locale?: Locale;
}

export interface InfoRow {
  label: string;
  value: string;
}

export interface TotalRow {
  label: string;
  value: string;
  emphasis?: true;
}

export interface PartyView {
  name: string;
  /** Name (or trade name) + street(s) + postal code and city [+ country, if different]. */
  addressLines: string[];
}

export interface LineView {
  pos: string;
  name: string;
  description?: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vat: string;
  netAmount: string;
  /** Allowances/charges of the line, price base quantity ≠ 1. */
  notes: string[];
}

export interface PaymentView {
  title: string;
  lines: string[];
}

export interface InvoiceViewModel {
  texts: Texts;
  title: string;
  number: string;
  /** Invoice date, formatted. */
  issueDate: string;
  /** Correction note ("Korrektur zu Rechnung … vom …") for 384/381 with a preceding invoice. */
  precedingLine?: string;
  senderLine: string;
  seller: PartyView;
  buyer: PartyView;
  delivery?: PartyView;
  infoRows: InfoRow[];
  lines: LineView[];
  totals: TotalRow[];
  /** Notes on tax exemption/reverse charge, below the totals block. */
  vatNotes: string[];
  payment?: PaymentView;
  notes: string[];
  footerColumns: string[][];
  embeddedNote: string;
}

const TEXTS: Readonly<Record<Locale, Texts>> = { de };

const CREDIT_TRANSFER = new Set(['30', '42', '58']);
const DIRECT_DEBIT = new Set(['49', '59']);

function addressLines(party: NormalizedParty, sellerCountry: string, texts: Texts): string[] {
  const a = party.address;
  const lines = [party.tradingName ?? party.name];
  if (party.tradingName !== undefined && party.tradingName !== party.name) lines.push(party.name);
  lines.push(a.street);
  if (a.street2 !== undefined) lines.push(a.street2);
  lines.push(`${a.postalCode} ${a.city}`);
  if (a.country !== sellerCountry) lines.push(texts.countries[a.country] ?? a.country);
  return lines;
}

function plainAddress(a: NormalizedAddress, sellerCountry: string, texts: Texts): string[] {
  const lines = [a.street];
  if (a.street2 !== undefined) lines.push(a.street2);
  lines.push(`${a.postalCode} ${a.city}`);
  if (a.country !== sellerCountry) lines.push(texts.countries[a.country] ?? a.country);
  return lines;
}

function percentSuffix(value: { kind: 'amount' } | { kind: 'percent'; percent: Decimal }): string {
  return value.kind === 'percent' ? ` ${fmtPercent(value.percent)}` : '';
}

function lineNotes(inv: CalculatedInvoice, line: CalculatedInvoice['lines'][number], texts: Texts): string[] {
  const notes: string[] = [];
  if (!line.priceBaseQuantity.eq(1)) {
    notes.push(fill(texts.priceBaseQuantity, { quantity: fmtQuantity(line.priceBaseQuantity), unit: unitName(line.unitCode, texts) }));
  }
  const ac = (items: CalculatedLineAllowanceCharge[], template: string, defaultReason: string, sign: -1 | 1): void => {
    for (const item of items) {
      notes.push(
        fill(template, {
          reason: item.reason ?? defaultReason,
          percent: percentSuffix(item.value),
          amount: fmtMoney(item.amount.times(sign), inv.currency),
        }),
      );
    }
  };
  ac(line.allowances, texts.lineAllowance, texts.allowanceDefaultReason, -1);
  ac(line.charges, texts.lineCharge, texts.chargeDefaultReason, 1);
  return notes;
}

function vatCell(line: { vat: { rate: Decimal } }): string {
  return fmtPercent(line.vat.rate);
}

function totals(inv: CalculatedInvoice, texts: Texts): TotalRow[] {
  const cur = inv.currency;
  const money = (v: Decimal): string => fmtMoney(v, cur);
  const rows: TotalRow[] = [];
  const t = inv.totals;
  const hasDocAc = inv.allowances.length > 0 || inv.charges.length > 0;
  if (hasDocAc) {
    rows.push({ label: texts.lineTotal, value: money(t.lineTotal) });
    const docAc = (items: CalculatedDocumentAllowanceCharge[], template: string, defaultReason: string, sign: -1 | 1): void => {
      for (const item of items) {
        rows.push({
          label: fill(template, { reason: item.reason ?? defaultReason, percent: percentSuffix(item.value) }),
          value: money(item.amount.times(sign)),
        });
      }
    };
    docAc(inv.allowances, texts.docAllowance, texts.allowanceDefaultReason, -1);
    docAc(inv.charges, texts.docCharge, texts.chargeDefaultReason, 1);
  }
  rows.push({ label: texts.netTotal, value: money(t.taxExclusiveAmount) });
  for (const e of inv.vatBreakdown) {
    if (e.category !== 'S') continue;
    rows.push({ label: fill(texts.vatLine, { rate: fmtPercent(e.rate), base: money(e.taxableAmount) }), value: money(e.taxAmount) });
  }
  rows.push({ label: texts.grossTotal, value: money(t.taxInclusiveAmount), emphasis: true });
  if (!t.prepaidAmount.isZero()) rows.push({ label: texts.prepaid, value: money(t.prepaidAmount.neg()) });
  if (!t.roundingAmount.isZero()) rows.push({ label: texts.rounding, value: money(t.roundingAmount) });
  rows.push({ label: texts.payable, value: money(t.payableAmount), emphasis: true });
  return rows;
}

/** Text for the tax category of a breakdown entry (for the notes below the totals). */
export function vatCategoryText(entry: Pick<VatBreakdownEntry, 'category' | 'rate'> & { exemptionReason?: string }, texts: Texts): string {
  switch (entry.category) {
    case 'S':
      return fill(texts.vatStandard, { rate: fmtPercent(entry.rate) });
    case 'Z':
      return texts.vatZero;
    case 'E':
    case 'AE':
    case 'K':
    case 'G':
    case 'O':
    case 'L':
    case 'M':
      return entry.exemptionReason ?? texts.vatExemptFallback;
  }
}

/** Exemption reason per (category, rate), as in the serializer: the first element with text wins. */
function exemptionReasonFor(inv: CalculatedInvoice, e: VatBreakdownEntry): string | undefined {
  const candidates = [...inv.lines.map((l) => l.vat), ...inv.allowances.map((a) => a.vat), ...inv.charges.map((c) => c.vat)];
  return candidates.find((v) => v.category === e.category && v.rate.eq(e.rate) && v.exemptionReason !== undefined)?.exemptionReason;
}

function vatNotes(inv: CalculatedInvoice, texts: Texts): string[] {
  const notes: string[] = [];
  const multi = inv.vatBreakdown.length > 1;
  for (const e of inv.vatBreakdown) {
    if (e.category === 'S') continue;
    const reason = exemptionReasonFor(inv, e);
    const text = vatCategoryText(reason === undefined ? e : { ...e, exemptionReason: reason }, texts);
    notes.push(multi ? fill(texts.vatNoteWithBase, { reason: text, base: fmtMoney(e.taxableAmount, inv.currency) }) : text);
  }
  return notes;
}

const SKONTO = /^#SKONTO#TAGE=(\d+)#PROZENT=(\d+(?:\.\d+)?)#(?:BASISBETRAG=(-?\d+(?:\.\d+)?)#)?$/;

/** BT-20 text: make `#SKONTO#…#` lines (BR-DE-18) readable, leave the remaining lines unchanged. */
export function termsLines(terms: string, currency: string, texts: Texts): string[] {
  return terms
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const m = SKONTO.exec(l);
      if (!m) return l;
      const base = m[3] === undefined ? '' : fill(texts.skontoBase, { amount: fmtMoney(D(m[3]), currency) });
      return fill(texts.skonto, { percent: fmtPercent(D(m[2] ?? '0')), days: m[1] ?? '', base });
    });
}

function payment(inv: CalculatedInvoice, texts: Texts): PaymentView | undefined {
  const p: NormalizedPayment | undefined = inv.payment;
  const amount = fmtMoney(inv.totals.payableAmount, inv.currency);
  const due = inv.dueDate === undefined ? undefined : fmtDate(inv.dueDate);
  const lines: string[] = [];
  if (p?.terms !== undefined) lines.push(...termsLines(p.terms, inv.currency, texts));
  if (p !== undefined) {
    if (CREDIT_TRANSFER.has(p.meansCode) && p.iban !== undefined) {
      lines.push(due === undefined ? fill(texts.payTransferNoDate, { amount }) : fill(texts.payTransfer, { amount, date: due }));
      const account = [fill(texts.payAccount, { iban: fmtIban(p.iban) })];
      if (p.bic !== undefined) account.push(fill(texts.payBic, { bic: p.bic }));
      if (p.accountHolder !== undefined) account.push(fill(texts.payHolder, { holder: p.accountHolder }));
      lines.push(account.join(texts.separator));
      if (p.reference !== undefined) lines.push(fill(texts.payReference, { reference: p.reference }));
    } else if (DIRECT_DEBIT.has(p.meansCode)) {
      const iban = p.debitedIban === undefined ? '…' : fmtIban(p.debitedIban);
      lines.push(due === undefined ? fill(texts.payDirectDebitNoDate, { amount, iban }) : fill(texts.payDirectDebit, { amount, date: due, iban }));
      const ids: string[] = [];
      if (p.creditorId !== undefined) ids.push(fill(texts.payCreditorId, { creditorId: p.creditorId }));
      if (p.mandateReference !== undefined) ids.push(fill(texts.payMandate, { mandate: p.mandateReference }));
      if (ids.length > 0) lines.push(ids.join(texts.separator));
    } else if (p.meansCode === '48') {
      lines.push(fill(texts.payCard, { amount }));
    } else if (p.meansCode === '10') {
      lines.push(fill(texts.payCash, { amount }));
    } else if (due !== undefined) {
      lines.push(fill(texts.payDue, { date: due }));
    }
  } else if (due !== undefined) {
    lines.push(fill(texts.payDue, { date: due }));
  }
  return lines.length === 0 ? undefined : { title: texts.paymentTitle, lines };
}

function infoRows(inv: CalculatedInvoice, texts: Texts): InfoRow[] {
  const rows: InfoRow[] = [{ label: inv.typeCode === '381' ? texts.creditNoteNumber : texts.invoiceNumber, value: inv.number }];
  rows.push({ label: texts.issueDate, value: fmtDate(inv.issueDate) });
  if (inv.buyer.id !== undefined) rows.push({ label: texts.customerId, value: inv.buyer.id });
  if (inv.delivery?.date !== undefined) rows.push({ label: texts.deliveryDate, value: fmtDate(inv.delivery.date) });
  if (inv.periodStart !== undefined || inv.periodEnd !== undefined) {
    const parts = [inv.periodStart, inv.periodEnd].filter((d): d is string => d !== undefined).map(fmtDate);
    // The last space of the separator becomes a non-breaking space: if the info column
    // (narrow, see templates) wraps, "– 31.08.2026" lands as a unit on the second line instead of a lone
    // dash on its own third line (bugfix part 1, service period).
    const sep = texts.rangeSeparator.replace(/ (?=\S*$)/, ' ');
    rows.push({ label: texts.servicePeriod, value: parts.join(sep) });
  }
  if (inv.dueDate !== undefined) rows.push({ label: texts.dueDate, value: fmtDate(inv.dueDate) });
  if (inv.buyer.orderReference !== undefined) rows.push({ label: texts.orderReference, value: inv.buyer.orderReference });
  if (inv.buyerReference !== undefined) rows.push({ label: texts.buyerReference, value: inv.buyerReference });
  if (inv.buyer.vatId !== undefined) rows.push({ label: texts.buyerVatId, value: inv.buyer.vatId });
  if (inv.seller.contact?.name !== undefined) rows.push({ label: texts.contactPerson, value: inv.seller.contact.name });
  return rows;
}

function footerColumns(inv: CalculatedInvoice, texts: Texts): string[][] {
  const s = inv.seller;
  const cols: string[][] = [addressLines(s, s.address.country, texts)];
  const contact: string[] = [];
  if (s.contact?.phone !== undefined) contact.push(fill(texts.phone, { phone: s.contact.phone }));
  if (s.contact?.email !== undefined) contact.push(s.contact.email);
  if (contact.length > 0) cols.push(contact);
  const ids: string[] = [];
  if (s.vatId !== undefined) ids.push(fill(texts.vatId, { vatId: s.vatId }));
  if (s.taxNumber !== undefined) ids.push(fill(texts.taxNumber, { taxNumber: s.taxNumber }));
  if (s.legalRegistration !== undefined) ids.push(fill(texts.legalRegistration, { id: s.legalRegistration.id }));
  if (ids.length > 0) cols.push(ids);
  const bank: string[] = [];
  if (inv.payment?.iban !== undefined) bank.push(fill(texts.payAccount, { iban: fmtIban(inv.payment.iban) }));
  if (inv.payment?.bic !== undefined) bank.push(fill(texts.payBic, { bic: inv.payment.bic }));
  if (bank.length > 0) cols.push(bank);
  return cols;
}

function precedingLine(inv: CalculatedInvoice, texts: Texts): string | undefined {
  const first = inv.precedingInvoices[0];
  if (first === undefined) return undefined;
  const credit = inv.typeCode === '381';
  if (first.issueDate === undefined) return fill(credit ? texts.precedingCreditNoteNoDate : texts.precedingInvoiceNoDate, { number: first.number });
  return fill(credit ? texts.precedingCreditNote : texts.precedingInvoice, { number: first.number, date: fmtDate(first.issueDate) });
}

export function toViewModel(inv: CalculatedInvoice, options: ViewModelOptions = {}): InvoiceViewModel {
  const texts = TEXTS[options.locale ?? 'de'];
  const sellerCountry = inv.seller.address.country;
  const s = inv.seller;
  const titles = { '380': texts.title380, '381': texts.title381, '384': texts.title384 } as const;

  const vm: InvoiceViewModel = {
    texts,
    title: titles[inv.typeCode],
    number: inv.number,
    issueDate: fmtDate(inv.issueDate),
    senderLine: [s.name, s.address.street, `${s.address.postalCode} ${s.address.city}`].join(texts.separator),
    seller: { name: s.name, addressLines: addressLines(s, sellerCountry, texts) },
    buyer: { name: inv.buyer.name, addressLines: addressLines(inv.buyer, sellerCountry, texts) },
    infoRows: infoRows(inv, texts),
    lines: inv.lines.map((l) => {
      const line: LineView = {
        pos: l.id,
        name: l.name,
        quantity: fmtQuantity(l.quantity),
        unit: unitName(l.unitCode, texts),
        unitPrice: fmtMoney(l.unitPrice, inv.currency),
        vat: vatCell(l),
        netAmount: fmtMoney(l.netAmount, inv.currency),
        notes: lineNotes(inv, l, texts),
      };
      if (l.description !== undefined) line.description = l.description;
      return line;
    }),
    totals: totals(inv, texts),
    vatNotes: vatNotes(inv, texts),
    notes: inv.notes,
    footerColumns: footerColumns(inv, texts),
    embeddedNote: fill(texts.embeddedNote, { profile: texts.profileNames[inv.profile] }),
  };
  const preceding = precedingLine(inv, texts);
  if (preceding !== undefined) vm.precedingLine = preceding;
  const pay = payment(inv, texts);
  if (pay !== undefined) vm.payment = pay;
  if (inv.delivery?.address !== undefined) {
    const name = inv.delivery.recipientName ?? inv.buyer.name;
    vm.delivery = { name, addressLines: [name, ...plainAddress(inv.delivery.address, sellerCountry, texts)] };
  }
  return vm;
}
