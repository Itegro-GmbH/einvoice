/**
 * Normalization: public input object -> internal EN 16931-oriented model.
 *
 * Deterministic and pure. Collects all errors and throws them together as `InvoiceError`
 * (rule `IF-SCHEMA-001` for structural errors, `IF-NORM-xxx` for normalization errors).
 *
 * Rule IDs:
 * - IF-NORM-001 unknown unit (BT-130)
 * - IF-NORM-002 unknown payment means (BT-81); currently already caught by the schema, this is a safety net
 * - IF-NORM-003 duplicate line ID (BT-126)
 * - IF-NORM-004 `deliveryDate` (alias) and `delivery.date` contradict each other (BT-72)
 * - IF-NORM-010 unparsable amount / quantity / rate
 * - IF-NORM-011 price base quantity <= 0 (BT-149); would be a division by zero
 */
import {
  INVOICE_TYPE_MAP,
  PAYMENT_MEANS_HINT,
  PROFILE_URNS,
  UNIT_ALIAS_HINT,
  resolvePaymentMeans,
  resolveUnit,
} from '../codelists/index.js';
import { InvoiceError, type Violation } from '../errors/index.js';
import { ONE, ZERO, fromInput, type Decimal } from '../money/index.js';
import {
  parseInvoiceInput,
  type AmountInput,
  type InvoiceInput,
  type ParsedInvoiceInput,
  type VatCategory,
} from '../model/input.js';
import type {
  AllowanceChargeValue,
  NormalizedAddress,
  NormalizedBuyer,
  NormalizedDelivery,
  NormalizedDocumentAllowanceCharge,
  NormalizedInvoice,
  NormalizedLine,
  NormalizedLineAllowanceCharge,
  NormalizedParty,
  NormalizedPayment,
  NormalizedVat,
} from '../model/normalized.js';

type ParsedParty = ParsedInvoiceInput['seller'];
type ParsedBuyer = ParsedInvoiceInput['buyer'];
type ParsedAddress = ParsedParty['address'];
type ParsedLine = ParsedInvoiceInput['lines'][number];
type ParsedVat = ParsedLine['vat'];
type ParsedLineAllowanceCharge = NonNullable<ParsedLine['allowances']>[number];
type ParsedDocumentAllowanceCharge = NonNullable<ParsedInvoiceInput['allowances']>[number];

class Collector {
  readonly violations: Violation[] = [];

  add(v: Violation): void {
    this.violations.push(v);
  }

  /** Parses an amount; on failure, a violation is collected and `ZERO` is returned as a placeholder. */
  amount(value: AmountInput, path: string, businessTerm: string): Decimal {
    try {
      return fromInput(value);
    } catch (e) {
      this.add({
        rule: 'IF-NORM-010',
        path,
        businessTerm,
        message: e instanceof Error ? e.message : String(e),
        hint: 'Provide amounts as a number or as a string with a dot as the decimal separator, e.g. 1234.5 or "1234.50".',
      });
      return ZERO;
    }
  }

  optionalAmount(value: AmountInput | undefined, path: string, businessTerm: string, fallback: Decimal): Decimal {
    return value === undefined ? fallback : this.amount(value, path, businessTerm);
  }

  throwIfAny(): void {
    if (this.violations.length > 0) throw new InvoiceError(this.violations);
  }
}

/** Copies only defined values, so that `exactOptionalPropertyTypes` stays clean. */
function withOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function normalizeAddress(a: ParsedAddress): NormalizedAddress {
  const out: NormalizedAddress = { street: a.street, city: a.city, postalCode: a.postalCode, country: a.country };
  withOptional(out, 'street2', a.street2);
  return out;
}

function normalizeParty(p: ParsedParty): NormalizedParty {
  const out: NormalizedParty = {
    name: p.name,
    address: normalizeAddress(p.address),
  };
  withOptional(out, 'id', p.id);
  withOptional(out, 'tradingName', p.tradingName);
  if (p.legalRegistration) {
    const lr: NormalizedParty['legalRegistration'] = { id: p.legalRegistration.id };
    withOptional(lr, 'scheme', p.legalRegistration.scheme);
    out.legalRegistration = lr;
  }
  withOptional(out, 'vatId', p.vatId);
  withOptional(out, 'taxNumber', p.taxNumber);
  if (p.contact) {
    const contact: NormalizedParty['contact'] = {};
    withOptional(contact, 'name', p.contact.name);
    withOptional(contact, 'email', p.contact.email);
    withOptional(contact, 'phone', p.contact.phone);
    out.contact = contact;
  }
  if (p.electronicAddress) {
    out.electronicAddress = { scheme: p.electronicAddress.scheme, value: p.electronicAddress.value };
  }
  return out;
}

function normalizeBuyer(p: ParsedBuyer): NormalizedBuyer {
  const out: NormalizedBuyer = normalizeParty(p);
  withOptional(out, 'orderReference', p.orderReference);
  return out;
}

/**
 * Default VAT exemption reasons (BT-120/BT-121) for categories whose reason is unambiguous.
 * `E` (exempt from VAT) has no default; there, the caller must name the legal provision (BR-E-10).
 *
 * These reason texts become part of the invoice content itself (BT-120, rendered into the XML
 * and the PDF), not a developer-facing API message; they stay German like the rest of the
 * invoice's business content, citing the German VAT act (UStG) they are based on.
 */
export const DEFAULT_EXEMPTION: Readonly<Partial<Record<VatCategory, { code: string; reason: string }>>> = {
  AE: { code: 'VATEX-EU-AE', reason: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, § 13b UStG)' },
  K: { code: 'VATEX-EU-IC', reason: 'Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG)' },
  G: { code: 'VATEX-EU-G', reason: 'Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1a UStG)' },
  O: { code: 'VATEX-EU-O', reason: 'Nicht im Anwendungsbereich der Umsatzsteuer' },
};

function normalizeVat(c: Collector, vat: ParsedVat, path: string, rateTerm: string): NormalizedVat {
  const out: NormalizedVat = {
    category: vat.category,
    rate: c.optionalAmount(vat.rate, `${path}.rate`, rateTerm, ZERO),
  };
  const def = DEFAULT_EXEMPTION[vat.category];
  withOptional(out, 'exemptionReason', vat.exemptionReason ?? def?.reason);
  withOptional(out, 'exemptionReasonCode', vat.exemptionReasonCode ?? def?.code);
  return out;
}

function normalizeDelivery(c: Collector, parsed: ParsedInvoiceInput): NormalizedDelivery | undefined {
  const alias = parsed.deliveryDate;
  const d = parsed.delivery;
  if (alias !== undefined && d?.date !== undefined && alias !== d.date) {
    c.add({
      rule: 'IF-NORM-004',
      path: 'deliveryDate',
      businessTerm: 'BT-72',
      message: `deliveryDate (${alias}) and delivery.date (${d.date}) contradict each other.`,
      hint: 'Provide only one of the two; deliveryDate is an alias for delivery.date.',
    });
  }
  const date = d?.date ?? alias;
  if (date === undefined && d === undefined) return undefined;
  const out: NormalizedDelivery = {};
  withOptional(out, 'date', date);
  if (d?.address) out.address = normalizeAddress(d.address);
  withOptional(out, 'recipientName', d?.recipientName);
  return out;
}

function normalizeAllowanceChargeValue(
  c: Collector,
  ac: { amount?: AmountInput | undefined; percent?: AmountInput | undefined },
  path: string,
  amountTerm: string,
  percentTerm: string,
): AllowanceChargeValue {
  if (ac.percent !== undefined) {
    return { kind: 'percent', percent: c.amount(ac.percent, `${path}.percent`, percentTerm) };
  }
  // The schema guarantees: exactly one of amount/percent is set.
  return { kind: 'amount', amount: c.amount(ac.amount ?? ZERO.toString(), `${path}.amount`, amountTerm) };
}

function normalizeLineAllowanceCharge(
  c: Collector,
  ac: ParsedLineAllowanceCharge,
  path: string,
  terms: { amount: string; percent: string },
): NormalizedLineAllowanceCharge {
  const out: NormalizedLineAllowanceCharge = {
    value: normalizeAllowanceChargeValue(c, ac, path, terms.amount, terms.percent),
  };
  withOptional(out, 'reason', ac.reason);
  withOptional(out, 'reasonCode', ac.reasonCode);
  return out;
}

function normalizeDocumentAllowanceCharge(
  c: Collector,
  ac: ParsedDocumentAllowanceCharge,
  path: string,
  terms: { amount: string; percent: string; rate: string },
): NormalizedDocumentAllowanceCharge {
  const out: NormalizedDocumentAllowanceCharge = {
    value: normalizeAllowanceChargeValue(c, ac, path, terms.amount, terms.percent),
    vat: normalizeVat(c, ac.vat, `${path}.vat`, terms.rate),
  };
  withOptional(out, 'reason', ac.reason);
  withOptional(out, 'reasonCode', ac.reasonCode);
  return out;
}

function normalizeLine(c: Collector, line: ParsedLine, index: number): NormalizedLine {
  const path = `lines[${String(index)}]`;

  const unit = resolveUnit(line.unit);
  let unitCode = line.unit;
  if (unit.ok) {
    unitCode = unit.code;
  } else {
    c.add({
      rule: 'IF-NORM-001',
      path: `${path}.unit`,
      businessTerm: 'BT-130',
      message: `Unknown unit "${line.unit}".`,
      hint: `Known aliases: ${UNIT_ALIAS_HINT}`,
    });
  }

  const priceBaseQuantity = c.optionalAmount(line.priceBaseQuantity, `${path}.priceBaseQuantity`, 'BT-149', ONE);
  if (!priceBaseQuantity.gt(ZERO)) {
    c.add({
      rule: 'IF-NORM-011',
      path: `${path}.priceBaseQuantity`,
      businessTerm: 'BT-149',
      message: `The price base quantity must be greater than 0, got: ${priceBaseQuantity.toString()}.`,
      hint: 'Omit priceBaseQuantity (default 1), or provide e.g. 100 for "price per 100 units".',
    });
  }

  const out: NormalizedLine = {
    id: line.id ?? String(index + 1),
    name: line.name,
    quantity: c.amount(line.quantity, `${path}.quantity`, 'BT-129'),
    unitCode,
    unitPrice: c.amount(line.unitPrice, `${path}.unitPrice`, 'BT-146'),
    priceBaseQuantity,
    vat: normalizeVat(c, line.vat, `${path}.vat`, 'BT-152'),
    allowances: (line.allowances ?? []).map((ac, i) =>
      normalizeLineAllowanceCharge(c, ac, `${path}.allowances[${String(i)}]`, { amount: 'BT-136', percent: 'BT-138' }),
    ),
    charges: (line.charges ?? []).map((ac, i) =>
      normalizeLineAllowanceCharge(c, ac, `${path}.charges[${String(i)}]`, { amount: 'BT-141', percent: 'BT-143' }),
    ),
  };
  withOptional(out, 'description', line.description);
  return out;
}

function normalizePayment(c: Collector, p: NonNullable<ParsedInvoiceInput['payment']>): NormalizedPayment {
  const means = resolvePaymentMeans(p.means);
  let meansCode: string = p.means;
  if (means.ok) {
    meansCode = means.code;
  } else {
    c.add({
      rule: 'IF-NORM-002',
      path: 'payment.means',
      businessTerm: 'BT-81',
      message: `Unknown payment means "${p.means}".`,
      hint: PAYMENT_MEANS_HINT,
    });
  }
  const out: NormalizedPayment = { meansCode };
  withOptional(out, 'iban', p.iban);
  withOptional(out, 'bic', p.bic);
  withOptional(out, 'accountHolder', p.accountHolder);
  withOptional(out, 'terms', p.terms === undefined ? undefined : normalizeTerms(p.terms));
  withOptional(out, 'reference', p.reference);
  withOptional(out, 'mandateReference', p.mandateReference);
  withOptional(out, 'creditorId', p.creditorId);
  withOptional(out, 'debitedIban', p.debitedIban);
  return out;
}

/**
 * BT-20: XRechnung (BR-DE-18) requires a line break after every complete early payment discount
 * entry `#SKONTO#…#`, including the last one. If a discount line ends the string without a line
 * break, one is added (no data loss).
 */
export function normalizeTerms(terms: string): string {
  const lastLine = terms.split(/\r?\n/).at(-1) ?? '';
  return lastLine.startsWith('#') && lastLine.endsWith('#') ? `${terms}\n` : terms;
}

function checkDuplicateLineIds(c: Collector, lines: readonly NormalizedLine[]): void {
  const seen = new Map<string, number>();
  lines.forEach((line, i) => {
    const first = seen.get(line.id);
    if (first === undefined) {
      seen.set(line.id, i);
      return;
    }
    c.add({
      rule: 'IF-NORM-003',
      path: `lines[${String(i)}].id`,
      businessTerm: 'BT-126',
      message: `Line ID "${line.id}" is duplicated (already used in lines[${String(first)}]).`,
      hint: 'Line IDs must be unique. Without explicit IDs, they are assigned sequentially starting at 1.',
    });
  });
}

/**
 * Normalizes the input. Throws `InvoiceError` on structural or normalization errors.
 * No totals are computed here; that is the responsibility of `calculate()`.
 */
export function normalize(input: InvoiceInput | unknown): NormalizedInvoice {
  const parsed = parseInvoiceInput(input);
  const c = new Collector();

  const lines = parsed.lines.map((line, i) => normalizeLine(c, line, i));
  checkDuplicateLineIds(c, lines);

  const out: NormalizedInvoice = {
    profile: parsed.profile,
    profileUrn: PROFILE_URNS[parsed.profile],
    number: parsed.number,
    typeCode: INVOICE_TYPE_MAP[parsed.type],
    issueDate: parsed.issueDate,
    currency: parsed.currency,
    notes: [...(parsed.notes ?? [])],
    precedingInvoices: (parsed.precedingInvoices ?? []).map((p) => {
      const out: NormalizedInvoice['precedingInvoices'][number] = { number: p.number };
      withOptional(out, 'issueDate', p.issueDate);
      return out;
    }),
    seller: normalizeParty(parsed.seller),
    buyer: normalizeBuyer(parsed.buyer),
    lines,
    allowances: (parsed.allowances ?? []).map((ac, i) =>
      normalizeDocumentAllowanceCharge(c, ac, `allowances[${String(i)}]`, { amount: 'BT-92', percent: 'BT-94', rate: 'BT-96' }),
    ),
    charges: (parsed.charges ?? []).map((ac, i) =>
      normalizeDocumentAllowanceCharge(c, ac, `charges[${String(i)}]`, { amount: 'BT-99', percent: 'BT-101', rate: 'BT-103' }),
    ),
    prepaidAmount: c.optionalAmount(parsed.prepaidAmount, 'prepaidAmount', 'BT-113', ZERO),
    roundingAmount: c.optionalAmount(parsed.roundingAmount, 'roundingAmount', 'BT-114', ZERO),
  };
  withOptional(out, 'dueDate', parsed.dueDate);
  withOptional(out, 'delivery', normalizeDelivery(c, parsed));
  withOptional(out, 'periodStart', parsed.periodStart);
  withOptional(out, 'periodEnd', parsed.periodEnd);
  withOptional(out, 'buyerReference', parsed.buyerReference);
  if (parsed.payment !== undefined) out.payment = normalizePayment(c, parsed.payment);

  c.throwIfAny();
  return out;
}
