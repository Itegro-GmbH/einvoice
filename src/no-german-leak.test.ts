/**
 * Guards the rule that the public API is English only: none of the API-visible
 * text sources - rule descriptions, violation/warning messages and hints, Zod messages from
 * `parseTemplateOptions`/`checkLogo`, thrown `money` errors, codelist hints, and the Schematron
 * texts we substitute - may contain German text. PDF rendering (`render/i18n/de.ts`, the
 * templates), the German VAT exemption reason texts in `normalize.ts#DEFAULT_EXEMPTION` (invoice
 * content, not a developer message), and the German unit/payment-means input aliases (accepted
 * input vocabulary, not output text) are deliberately out of scope.
 *
 * This is a regression guard, not a 100% exhaustive enumeration of every rule: it combines a
 * complete static check of every rule's `description` with a broad battery of crafted invoices
 * that trigger a large majority of the `message`/`hint` producing code paths across every
 * category and profile, plus direct checks of the non-`validate` text sources (template options,
 * logo checks, money parsing, codelist hints, Schematron substitutions).
 */
import { describe, expect, it } from 'vitest';
import { calculate } from './calculate/index.js';
import { PAYMENT_MEANS_HINT } from './codelists/payment-means.js';
import { UNIT_ALIAS_HINT } from './codelists/units.js';
import { SCHEMATRON_HINT } from './generate-xml.js';
import type { CalculatedInvoice } from './model/calculated.js';
import type { InvoiceInput } from './model/input.js';
import { fromInput } from './money/index.js';
import { normalize } from './normalize/index.js';
import { checkLogo } from './render/images.js';
import { parseTemplateOptions, TEMPLATE_DESCRIPTIONS } from './render/template-options.js';
import { RULES } from './validate/rules.js';
import { SCHEMATRON_TEXTS } from './xml-validate/schematron-texts.js';
import { validate, type ValidationResult } from './validate/index.js';

/**
 * German markers: the diacritics ä/ö/ü/ß are a near-zero-false-positive signal on their own; the
 * word list catches plain-ASCII German words that would otherwise slip through. Kept short and
 * unambiguous (no words that are also common English words or code tokens) to avoid false
 * positives on English messages that happen to share a substring with German.
 */
const GERMAN_DIACRITICS = /[äöüßÄÖÜ]/;
const GERMAN_WORDS =
  /\b(und|oder|nicht|kein|keine|keinen|keiner|muss|müssen|bitte|ungültig|gültig|erwartet|angeben|enthält|Rechnung|Betrag|Fehler|Zeile|Zeilen|Verkäufer|Käufer|Steuer|Umsatzsteuer|dieser|diese|dieses|jede|jeder|jedes|ohne|innerhalb|außerhalb|zwischen|während|deshalb|daher|damit|dadurch|wobei|weder|noch|sowie|sofort|fällig|Zahlungsart|Lastschrift|Überweisung|Grund|Kategorie|Satz|Pflicht|verlangt|liegt|entspricht|passt)\b/i;

function findGermanMarkers(text: string): string[] {
  const hits: string[] = [];
  if (GERMAN_DIACRITICS.test(text)) hits.push('diacritics');
  const wordMatch = GERMAN_WORDS.exec(text);
  if (wordMatch) hits.push(`word:${wordMatch[0]}`);
  return hits;
}

function expectEnglish(text: string, source: string): void {
  const hits = findGermanMarkers(text);
  expect(hits, `possible German text leaking into the API from ${source}: ${JSON.stringify(text)} (markers: ${hits.join(', ')})`).toEqual([]);
}

function run(input: InvoiceInput): ValidationResult {
  return validate(calculate(normalize(input)));
}

function collect(result: ValidationResult, into: { message: string; hint?: string; source: string }[], source: string): void {
  for (const v of result.violations) into.push({ message: v.message, ...(v.hint !== undefined ? { hint: v.hint } : {}), source: `${source} violation ${v.rule}` });
  for (const w of result.warnings) into.push({ message: w.message, ...(w.hint !== undefined ? { hint: w.hint } : {}), source: `${source} warning ${w.code}` });
}

describe('no German text leaks through the public API', () => {
  it('every rule description in the catalog is English', () => {
    for (const rule of RULES) {
      expectEnglish(rule.description, `RULES["${rule.id}"].description`);
    }
  });

  it('violation and warning messages/hints from a broad battery of invalid invoices are English', () => {
    const collected: { message: string; hint?: string; source: string }[] = [];

    const de = { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' };
    const at = { street: 'Ring 1', city: 'Wien', postalCode: '1010', country: 'AT' };
    const seller = { name: 'Musterwerk GmbH', address: de, vatId: 'DE123456789' };
    const buyer = { name: 'Beispiel KG', address: de };
    const line = { name: 'Beratung', quantity: 12, unit: 'Stunde', unitPrice: '95.00', vat: { category: 'S' as const, rate: 19 } };
    const base: InvoiceInput = { number: 'RE-1', issueDate: '2026-09-12', dueDate: '2026-09-26', deliveryDate: '2026-09-10', seller, buyer, payment: { means: 'transfer', iban: 'DE89370400440532013000' }, lines: [line] };

    // Document-level rules: tamper the calculated object directly, like validate.test.ts does.
    const tamperCases: Array<(c: CalculatedInvoice) => void> = [
      (c) => void (c.profileUrn = ''),
      (c) => void (c.number = ''),
      (c) => void (c.currency = ''),
      (c) => void (c.seller.name = ''),
      (c) => void (c.buyer.name = ''),
      (c) => void (c.seller.address.country = ''),
      (c) => void (c.buyer.address.country = ''),
      (c) => void (c.lines = []),
    ];
    for (const mut of tamperCases) {
      const c = calculate(normalize(base));
      mut(c);
      collect(validate(c), collected, 'document rule');
    }

    const invalidInvoices: InvoiceInput[] = [
      // BR-27, BR-33/38/42/44, BR-DEC-*, IF-DEC-001
      { ...base, lines: [{ ...line, unitPrice: '-5.00', allowances: [{ percent: 10 }], charges: [{ amount: '0.456', reason: 'x' }] }], allowances: [{ amount: 5, vat: { category: 'S', rate: 19 } }], charges: [{ amount: 3, vat: { category: 'S', rate: 19 } }], prepaidAmount: '10.005' },
      { ...base, lines: [{ ...line, unitPrice: '1.23456' }] },
      // BR-29, IF-WARN-007
      { ...base, periodStart: '2026-09-10', periodEnd: '2026-09-01' },
      { ...base, periodStart: '2026-09-01' },
      // Category S
      { ...base, lines: [{ ...line, vat: { category: 'S', rate: 0 } }] },
      { ...base, seller: { name: seller.name, address: de }, lines: [{ ...line }] },
      { ...base, lines: [{ ...line, vat: { category: 'S', rate: 19, exemptionReason: 'x' } }] },
      // Category Z
      { ...base, lines: [{ ...line, vat: { category: 'Z', rate: 19 } }] },
      { ...base, lines: [{ ...line, vat: { category: 'Z', rate: 0, exemptionReasonCode: 'VATEX-EU-O' } }] },
      // Category E
      { ...base, lines: [{ ...line, vat: { category: 'E' } }] },
      { ...base, lines: [{ ...line, vat: { category: 'E', rate: 7, exemptionReason: 'x' } }] },
      // Category AE
      { ...base, lines: [{ ...line, vat: { category: 'AE' } }] },
      {
        ...base,
        buyer: { ...buyer, vatId: 'ATU12345678', address: at },
        lines: [{ ...line, vat: { category: 'AE', rate: 19 } }],
        allowances: [{ amount: 1, reason: 'x', vat: { category: 'AE', rate: 19 } }],
        charges: [{ amount: 1, reason: 'x', vat: { category: 'AE', rate: 19 } }],
      },
      // Category K (intra-community)
      { ...base, buyer: { ...buyer, vatId: 'ATU12345678', address: at }, lines: [{ ...line, vat: { category: 'K' } }], delivery: { address: at } },
      { ...base, buyer: { ...buyer, vatId: 'ATU12345678', address: at }, lines: [{ ...line, vat: { category: 'K', rate: 20 } }], delivery: { date: '2026-09-10', address: at } },
      { ...base, buyer: { ...buyer, vatId: 'ATU12345678', address: at }, lines: [{ ...line, vat: { category: 'K' } }], delivery: { date: '2026-09-10' } },
      // Category G (export)
      { ...base, seller: { name: seller.name, address: de }, lines: [{ ...line, vat: { category: 'G' } }] },
      { ...base, lines: [{ ...line, vat: { category: 'G', rate: 1 } }] },
      // Category O (not subject to VAT) - mixing
      {
        ...base,
        seller: { ...seller, vatId: 'DE123456789' },
        buyer: { ...buyer, vatId: 'DE987654321' },
        lines: [line, { ...line, vat: { category: 'O' } }],
        allowances: [{ amount: 1, reason: 'x', vat: { category: 'S', rate: 19 } }],
        charges: [{ amount: 1, reason: 'x', vat: { category: 'S', rate: 19 } }],
      },
      // Category L (IGIC) / M (IPSI)
      { ...base, lines: [{ ...line, vat: { category: 'L', rate: 0 } }] },
      { ...base, lines: [{ ...line, vat: { category: 'L', rate: 7, exemptionReason: 'x' } }] },
      { ...base, lines: [{ ...line, vat: { category: 'M', rate: -1 } }] },
      // VAT identifier format
      { ...base, seller: { ...seller, vatId: '123456789' }, buyer: { ...buyer, vatId: 'ZZ123' } },
      { ...base, seller: { ...seller, vatId: 'DE12345678' } },
      // Payment
      { ...base, payment: { means: 'transfer', iban: 'DE89370400440532013001' } },
      { ...base, payment: { means: 'sepa-direct-debit', debitedIban: 'DE00', creditorId: 'DE98ZZZ09999999999', mandateReference: 'M' } },
      { ...base, payment: { ...base.payment!, bic: 'COBA' } },
      { ...base, payment: { means: '59', debitedIban: 'DE89370400440532013000', creditorId: 'DE97ZZZ09999999999', mandateReference: 'M' } },
      { ...base, payment: { means: 'sepa-direct-debit' } },
      { ...base, payment: { means: 'transfer' } },
      // XRechnung profile
      { number: 'RE-2', issueDate: '2026-09-12', profile: 'xrechnung', seller, buyer, lines: [line] },
      { number: 'RE-3', issueDate: '2026-09-12', profile: 'xrechnung', buyerReference: 'x', seller: { ...seller, contact: {} }, buyer, payment: { means: 'transfer', iban: 'DE89370400440532013000' }, lines: [line] },
      {
        number: 'RE-4',
        issueDate: '2026-09-12',
        profile: 'xrechnung',
        buyerReference: 'x',
        seller: { ...seller, contact: { name: 'A', phone: '+4-9', email: 'a@b.example' }, electronicAddress: { scheme: 'EM', value: 'a@b.example' } },
        buyer: { ...buyer, electronicAddress: { scheme: 'EM', value: 'b@c.example' } },
        payment: { means: 'transfer', iban: 'DE89370400440532013000', terms: '#SKONTO#TAGE=7#PROZENT=2#' },
        lines: [line],
      },
      {
        number: 'RE-5',
        issueDate: '2026-09-12',
        profile: 'xrechnung',
        buyerReference: 'x',
        seller: { ...seller, contact: { name: 'A', phone: '0711123', email: 'a@b.example' }, electronicAddress: { scheme: 'EM', value: 'a@b.example' } },
        buyer: { ...buyer, electronicAddress: { scheme: 'EM', value: 'b@c.example' } },
        payment: { means: 'sepa-direct-debit' },
        lines: [line],
      },
      // Factur-X BASIC profile
      { ...base, profile: 'basic', lines: [{ ...line, allowances: [{ percent: 10, reason: 'x' }] }], roundingAmount: '0.01' },
      { ...base, profile: 'basic', lines: [{ ...line, description: 'x' }], buyer: { ...buyer, contact: { name: 'x' } }, payment: { ...base.payment!, bic: 'COBADEFFXXX', accountHolder: 'x' } },
      // Other warnings
      { ...base, lines: [{ ...line, quantity: 0 }] },
      { ...base, deliveryDate: undefined },
      { ...base, type: 'correction' },
      { ...base, lines: [{ ...line, unitPrice: 0 }] },
      { ...base, lines: [{ ...line, vat: { category: 'S', rate: 16 } }] },
      { number: 'RE-6', issueDate: '2026-09-12', seller, buyer, lines: [line] },
      { ...base, dueDate: '2026-09-01' },
      { ...base, lines: [{ ...line, quantity: '1.23456' }] },
    ];

    for (const input of invalidInvoices) {
      collect(run(input), collected, 'invoice');
    }

    expect(collected.length).toBeGreaterThan(60);
    for (const { message, hint, source } of collected) {
      expectEnglish(message, `${source}.message`);
      if (hint !== undefined) expectEnglish(hint, `${source}.hint`);
    }
  });

  it('TEMPLATE_DESCRIPTIONS are English', () => {
    for (const [name, description] of Object.entries(TEMPLATE_DESCRIPTIONS)) {
      expectEnglish(description, `TEMPLATE_DESCRIPTIONS.${name}`);
    }
  });

  it('parseTemplateOptions (Zod) violation messages are English', () => {
    const badInputs: unknown[] = [
      { accentColor: 'blue' },
      { accentColor: '#abc' },
      { template: 'fancy' },
      { pageSize: 'Letter' },
      { footerText: 'x'.repeat(501) },
      { logo: { data: 'not base64!!', mime: 'image/png' } },
      { logo: { data: new Uint8Array(2 * 1024 * 1024 + 1), mime: 'image/png' } },
      { logo: { data: new Uint8Array([1, 2, 3]), mime: 'image/gif' } },
    ];
    for (const input of badInputs) {
      try {
        parseTemplateOptions(input);
        expect.fail(`expected parseTemplateOptions to throw for ${JSON.stringify(input)}`);
      } catch (e) {
        const violations = (e as { violations?: { message: string; hint?: string }[] }).violations ?? [];
        for (const v of violations) {
          expectEnglish(v.message, `parseTemplateOptions(${JSON.stringify(input)}).message`);
          if (v.hint !== undefined) expectEnglish(v.hint, `parseTemplateOptions(${JSON.stringify(input)}).hint`);
        }
      }
    }
  });

  it('checkLogo violation messages/hints are English', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0]);
    const findings = [...checkLogo({ data: pngBytes, mime: 'image/jpeg' }), ...checkLogo({ data: new Uint8Array([0xff, 0xd8, 0xff]), mime: 'image/jpeg' })];
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expectEnglish(f.message, 'checkLogo.message');
      if (f.hint !== undefined) expectEnglish(f.hint, 'checkLogo.hint');
    }
  });

  it('money.fromInput() thrown error messages are English', () => {
    const badValues: Array<number | string> = ['12,5', '1.234,50', '', 'abc', '12.5 EUR', Number.NaN, Number.POSITIVE_INFINITY];
    for (const value of badValues) {
      expect(() => fromInput(value)).toThrow();
      try {
        fromInput(value);
      } catch (e) {
        expectEnglish((e as Error).message, `fromInput(${JSON.stringify(value)})`);
      }
    }
  });

  it('codelist hints (embedded in IF-NORM-001/002) are English', () => {
    expectEnglish(UNIT_ALIAS_HINT, 'UNIT_ALIAS_HINT');
    expectEnglish(PAYMENT_MEANS_HINT, 'PAYMENT_MEANS_HINT');
  });

  it('the internal-error Schematron hint is English', () => {
    expectEnglish(SCHEMATRON_HINT, 'SCHEMATRON_HINT');
  });

  it('substituted Schematron texts (SCH-* warnings) are English', () => {
    for (const [rule, entry] of Object.entries(SCHEMATRON_TEXTS)) {
      expectEnglish(entry.message, `SCHEMATRON_TEXTS.${rule}.message`);
      if (entry.hint !== undefined) expectEnglish(entry.hint, `SCHEMATRON_TEXTS.${rule}.hint`);
    }
  });
});
