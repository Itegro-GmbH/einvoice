import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculate } from '../calculate/index.js';
import { normalize } from '../normalize/index.js';
import type { InvoiceInput } from '../model/input.js';
import { FIXTURE_DIR } from '../../test/golden/fixtures.js';
import { toViewModel } from './view-model.js';
import { de } from './i18n/de.js';

function load(name: string): InvoiceInput {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as InvoiceInput;
}
function vm(name: string, input: Partial<InvoiceInput> = {}) {
  return toViewModel(calculate(normalize({ ...load(name), ...input })), { locale: 'de' });
}

describe('toViewModel', () => {
  it('Fixture 01: header, info block, line items, totals', () => {
    const v = vm('01-simple-19-en16931');
    expect(v.texts).toBe(de);
    expect(v.title).toBe('Rechnung');
    expect(v.number).toBe('RE-2026-00001');
    expect(v.senderLine).toBe('Musterwerk GmbH · Industriestraße 12 · 70565 Stuttgart');
    expect(v.buyer.addressLines).toEqual(['Beispiel & Söhne KG', 'Hauptstraße 1', 'Hinterhaus', '10115 Berlin']);
    expect(v.seller.addressLines).toEqual(['Musterwerk GmbH', 'Industriestraße 12', '70565 Stuttgart']);
    expect(v.infoRows).toEqual([
      { label: 'Rechnungsnummer', value: 'RE-2026-00001' },
      { label: 'Rechnungsdatum', value: '12.09.2026' },
      { label: 'Leistungsdatum', value: '10.09.2026' },
      { label: 'Fälligkeitsdatum', value: '26.09.2026' },
      { label: 'Ihre Bestellnummer', value: 'PO-2026-77' },
      { label: 'Käuferreferenz', value: 'BESTELL-4711' },
      { label: 'Ihre USt-IdNr.', value: 'DE987654321' },
      { label: 'Ansprechpartner', value: 'Erika Muster' },
    ]);
    expect(v.lines[0]).toEqual({
      pos: '1',
      name: 'Beratung Rechnungsformat',
      description: 'Workshop EN 16931 und ZUGFeRD',
      quantity: '12',
      unit: 'Std.',
      unitPrice: '95,00 €',
      vat: '19 %',
      netAmount: '1.140,00 €',
      notes: [],
    });
    expect(v.lines[1]!.unit).toBe('pauschal');
    expect(v.lines[2]!.unit).toBe('Monat');
    expect(v.totals).toEqual([
      { label: 'Nettobetrag', value: '3.779,70 €' },
      { label: 'zzgl. 19 % Umsatzsteuer auf 3.779,70 €', value: '718,14 €' },
      { label: 'Gesamtbetrag', value: '4.497,84 €', emphasis: true },
      { label: 'Zahlbetrag', value: '4.497,84 €', emphasis: true },
    ]);
    expect(v.vatNotes).toEqual([]);
    expect(v.payment).toEqual({
      title: 'Zahlung',
      lines: [
        'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
        'Bitte überweisen Sie 4.497,84 € bis zum 26.09.2026 auf das folgende Konto:',
        'IBAN DE89 3704 0044 0532 0130 00 · BIC COBADEFFXXX · Kontoinhaber Musterwerk GmbH',
        'Verwendungszweck: RE-2026-00001',
      ],
    });
    expect(v.notes).toEqual(['Vielen Dank für Ihren Auftrag.']);
    expect(v.footerColumns).toEqual([
      ['Musterwerk GmbH', 'Industriestraße 12', '70565 Stuttgart'],
      ['Tel. +49 711 123456-0', 'rechnung@musterwerk.example'],
      ['USt-IdNr. DE123456789', 'Steuernummer 93815/08152', 'Handelsregister HRB 12345'],
      ['IBAN DE89 3704 0044 0532 0130 00', 'BIC COBADEFFXXX'],
    ]);
    expect(v.embeddedNote).toBe('Dieses PDF enthält eine maschinenlesbare Rechnung (ZUGFeRD/Factur-X, Profil EN 16931) als eingebettete Datei factur-x.xml.');
  });

  it('Fixture 02: period, line allowance as a note, document allowances/charges and two tax rates in the totals', () => {
    const v = vm('02-mixed-7-19-allowance-en16931');
    // Last space is a non-breaking space (U+00A0), bugfix part 1, see infoRows() in view-model.ts.
    expect(v.infoRows.find((r) => r.label === 'Leistungszeitraum')?.value).toBe('01.08.2026 – 31.08.2026');
    expect(v.lines[1]!.notes).toEqual(['Abschlag Treuerabatt 10 %: -96,00 €']);
    expect(v.lines[1]!.netAmount).toBe('864,00 €');
    expect(v.totals).toEqual([
      { label: 'Summe Positionen', value: '949,70 €' },
      { label: 'Abschlag Rahmenvertragsrabatt 5 %', value: '-43,50 €' },
      { label: 'Zuschlag Verpackung', value: '12,50 €' },
      { label: 'Nettobetrag', value: '918,70 €' },
      { label: 'zzgl. 7 % Umsatzsteuer auf 79,80 €', value: '5,59 €' },
      { label: 'zzgl. 19 % Umsatzsteuer auf 838,90 €', value: '159,39 €' },
      { label: 'Gesamtbetrag', value: '1.083,68 €', emphasis: true },
      { label: 'Zahlbetrag', value: '1.083,68 €', emphasis: true },
    ]);
  });

  it('Fixture 03 (AE): tax note reverse charge, tax line 0,00', () => {
    const v = vm('03-reverse-charge-ae');
    expect(v.vatNotes).toEqual(['Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, § 13b UStG)']);
    expect(v.totals.some((r) => r.label.startsWith('zzgl.'))).toBe(false);
  });

  it('Fixture 05 (E): exemption reason from the input', () => {
    const v = vm('05-small-business-e');
    expect(v.vatNotes.length).toBe(1);
    expect(v.vatNotes[0]).toMatch(/§ 19/);
  });

  it('credit note/correction: title and preceding invoice', () => {
    expect(vm('06-credit-note-381').title).toBe('Gutschrift');
    const k = vm('07-correction-384-preceding');
    expect(k.title).toBe('Rechnungskorrektur');
    expect(k.precedingLine).toMatch(/^Korrektur zu Rechnung .+ vom \d{2}\.\d{2}\.\d{4}$/);
  });

  it('direct debit (59): payment note with creditor ID and mandate', () => {
    const v = vm('08-direct-debit-59');
    expect(v.payment!.lines.join('\n')).toContain('SEPA-Lastschrift');
    expect(v.payment!.lines.join('\n')).toContain('DE98ZZZ09999999999');
    expect(v.payment!.lines.join('\n')).toContain('MANDAT-2024-0815');
    expect(v.payment!.lines.join('\n')).toContain('DE75 5121 0800 1245 1261 99');
  });

  it('XRechnung: early payment discount line (#SKONTO#) is translated into readable text', () => {
    const v = vm('09-xrechnung');
    expect(v.payment!.lines.some((l) => /Skonto/.test(l))).toBe(true);
    expect(v.payment!.lines.some((l) => l.includes('#SKONTO#'))).toBe(false);
  });

  it('prepayment and rounding appear only if ≠ 0', () => {
    const v = vm('01-simple-19-en16931', { prepaidAmount: '1000', roundingAmount: '0.01' });
    const labels = v.totals.map((r) => r.label);
    expect(labels).toContain('abzgl. Vorauszahlung');
    expect(labels).toContain('Rundung');
    expect(v.totals.at(-1)).toEqual({ label: 'Zahlbetrag', value: '3.497,85 €', emphasis: true });
  });

  it('customer number from buyer.id', () => {
    const v = vm('01-simple-19-en16931', { buyer: { ...load('01-simple-19-en16931').buyer, id: 'K-0815' } });
    expect(v.infoRows[2]).toEqual({ label: 'Kundennummer', value: 'K-0815' });
  });
});
