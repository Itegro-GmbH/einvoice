import fs from 'node:fs';
import path from 'node:path';
import type { InvoiceInput, LineInput } from '../../src/index.js';
import { FIXTURE_DIR } from '../golden/fixtures.js';

export function loadFixture(name: string): InvoiceInput {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as InvoiceInput;
}

/** Fixture 01 with `n` line items (for page break tests). */
export function longInvoice(n = 60): InvoiceInput {
  const base = loadFixture('01-simple-19-en16931');
  const lines: LineInput[] = Array.from({ length: n }, (_, i) => ({
    name: `Position ${String(i + 1)} – Beratungsleistung`,
    description: i % 3 === 0 ? 'Mit einer zweizeiligen Beschreibung, die den Zeilenumbruch in der Tabelle prüft.' : undefined,
    quantity: (i % 7) + 1,
    unit: i % 2 === 0 ? 'Stunde' : 'Stück',
    unitPrice: `${String(10 + i)}.50`,
    vat: { category: 'S', rate: i % 5 === 0 ? 7 : 19 },
  }));
  return { ...base, number: `RE-2026-LANG-${String(n)}`, lines };
}

/** 1×1 pixel PNG (RGBA) and a minimal baseline JPEG (RGB) for logo tests. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Stress fixture  (only for visual tests/veraPDF; no golden.test.ts entry, no fixed XML): long
 * company names (trade name differing), 4+ line addresses (street + addition + trade name), long
 * service period, long IBAN (Malta, 31 characters)/BIC (with branch code), delivery address, all footer fields
 * (contact, VAT ID, tax number, commercial register, bank), `n` line items for page breaks (table header,
 * "Seite n von m" (page n of m), totals block stays in one piece).
 */
export function stressInvoice(n = 42): InvoiceInput {
  const lines: LineInput[] = Array.from({ length: n }, (_, i) => ({
    name: `Position ${String(i + 1)} – Langfristige Beratungs- und Entwicklungsleistung im Rahmen des Digitalisierungsprojekts`,
    description:
      i % 2 === 0
        ? 'Sehr lange Positionsbezeichnung mit Zusatzbeschreibung, die den Zeilenumbruch in der Tabelle über mehrere Zeilen hinweg prüft und Seitenumbrüche innerhalb der Tabelle provoziert.'
        : undefined,
    quantity: (i % 9) + 1,
    unit: i % 3 === 0 ? 'Stunde' : i % 3 === 1 ? 'Stück' : 'Tag',
    unitPrice: `${String(15 + i * 3)}.75`,
    vat: { category: 'S', rate: i % 4 === 0 ? 7 : 19 },
    ...(i % 11 === 0 ? { allowances: [{ percent: 5, reason: 'Mengenrabatt', reasonCode: '95' }] } : {}),
  }));
  return {
    profile: 'en16931',
    number: 'RE-2026-STRESS-00099',
    issueDate: '2026-09-12',
    dueDate: '2026-11-10',
    periodStart: '2025-01-01',
    periodEnd: '2026-12-31',
    buyerReference: 'Leitweg-ID 04011000-1234512345-67',
    seller: {
      name: 'Musterwerk Industrielle Fertigungs- und Beratungsgesellschaft mbH & Co. Kommanditgesellschaft',
      tradingName: 'Musterwerk Systemtechnik',
      address: { street: 'Industriestraße 12-14', street2: 'Gebäude C, 3. Obergeschoss', city: 'Stuttgart', postalCode: '70565', country: 'DE' },
      vatId: 'DE123456789',
      taxNumber: '93815/08152',
      legalRegistration: { id: 'HRB 123456', scheme: '0002' },
      contact: { name: 'Erika Musterfrau-Langname', phone: '+49 711 123456-789', email: 'rechnungswesen.zentrale@musterwerk-systemtechnik.example' },
      electronicAddress: { scheme: 'EM', value: 'rechnung@musterwerk.example' },
    },
    buyer: {
      name: 'Beispiel & Söhne Handelsgesellschaft mit beschränkter Haftung',
      tradingName: 'Beispiel Großhandel',
      address: { street: 'Hauptstraße 1-3', street2: 'Hinterhaus, 2. Stock, Postfach 445566', city: 'Berlin', postalCode: '10115', country: 'DE' },
      vatId: 'DE987654321',
      orderReference: 'BEST-2026-ABCDEF-0099887766',
      electronicAddress: { scheme: 'EM', value: 'einkauf@beispiel.example' },
    },
    delivery: {
      date: '2026-08-31',
      recipientName: 'Beispiel & Söhne, Warenannahme Halle 7',
      address: { street: 'Logistikweg 9', street2: 'Tor 3, Rampe B', city: 'Potsdam', postalCode: '14467', country: 'DE' },
    },
    payment: {
      means: 'transfer',
      iban: 'MT84MALT011000012345MTLCAST001S',
      bic: 'MALTMTMTXXX',
      accountHolder: 'Musterwerk Industrielle Fertigungs- und Beratungsgesellschaft mbH & Co. KG',
      reference: 'RE-2026-STRESS-00099 / Projekt Digitalisierung Phase 2',
    },
    lines,
    allowances: [{ percent: 3, reason: 'Rahmenvertragsrabatt langjährige Zusammenarbeit', reasonCode: '95', vat: { category: 'S', rate: 19 } }],
    charges: [{ amount: '45.00', reason: 'Express-Versand und Sonderverpackung', reasonCode: 'PC', vat: { category: 'S', rate: 19 } }],
    notes: [
      'Diese Rechnung wird im Rahmen des Digitalisierungsprojekts 2026 gestellt und enthält Leistungen aus mehreren Teilprojekten.',
      'Bei Rückfragen wenden Sie sich bitte an die oben genannte Kontaktperson.',
    ],
  };
}
