import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { calculate } from '../calculate/index.js';
import { normalize } from '../normalize/index.js';
import { loadFixture, longInvoice, PNG_1X1 } from '../../test/helpers/fixtures.js';
import { pageTexts } from '../../test/helpers/pdf-text.js';
import { renderInvoice } from './render.js';
import { toViewModel } from './view-model.js';
import { TemplateOptionsSchema } from './template-options.js';

const vm = (name: string) => toViewModel(calculate(normalize(loadFixture(name))));

describe('renderInvoice (react-pdf)', () => {
  it('classic: a PDF with one page, without a standard-14 font, with all texts', async () => {
    const { pdf, pages } = await renderInvoice(vm('01-simple-19-en16931'), { template: TemplateOptionsSchema.parse({}) });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(pages).toBe(1);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    const raw = Buffer.from(pdf).toString('latin1');
    expect(raw).not.toContain('/Helvetica');
    expect(raw).toContain('DejaVuSans');
    const [p1] = await pageTexts(pdf);
    expect(p1).toContain('Rechnung');
    expect(p1).toContain('RE-2026-00001');
    expect(p1).toContain('4.497,84 €');
    expect(p1).toContain('Seite 1 von 1');
    expect(p1).toContain('IBAN DE89 3704 0044 0532 0130 00');
  });

  it('modern: renders as well', async () => {
    const { pdf, pages } = await renderInvoice(vm('02-mixed-7-19-allowance-en16931'), { template: TemplateOptionsSchema.parse({ template: 'modern' }) });
    expect(pages).toBe(1);
    const [p1] = await pageTexts(pdf);
    expect(p1).toContain('1.083,68 €');
    expect(p1).toContain('Abschlag Rahmenvertragsrabatt 5 %');
  });

  it('60 line items: multiple pages, table header on every page, "Seite n von m" correct', async () => {
    for (const template of ['classic', 'modern'] as const) {
      const v = toViewModel(calculate(normalize(longInvoice(60))));
      const { pdf, pages } = await renderInvoice(v, { template: TemplateOptionsSchema.parse({ template }) });
      expect(pages).toBeGreaterThanOrEqual(2);
      const texts = await pageTexts(pdf);
      expect(texts.length).toBe(pages);
      texts.forEach((t, i) => {
        expect(t, `${template} Seite ${String(i + 1)}`).toContain('Bezeichnung');
        expect(t).toContain(`Seite ${String(i + 1)} von ${String(pages)}`);
      });
      expect(texts.at(-1)).toContain('Zahlbetrag');
    }
  });

  it('watermark and logo are rendered', async () => {
    const { pdf } = await renderInvoice(vm('01-simple-19-en16931'), {
      template: TemplateOptionsSchema.parse({ logo: { data: PNG_1X1, mime: 'image/png' }, footerText: 'Danke für Ihren Auftrag!' }),
      watermark: 'TESTMODUS',
    });
    const [p1] = await pageTexts(pdf);
    expect(p1).toContain('TESTMODUS');
    expect(p1).toContain('Danke für Ihren Auftrag!');
    expect(Buffer.from(pdf).toString('latin1')).toContain('/Subtype /Image');
  });

  it('rendering is byte-deterministic except for CreationDate/ID', async () => {
    const opts = { template: TemplateOptionsSchema.parse({}) };
    const a = await renderInvoice(vm('01-simple-19-en16931'), opts);
    const b = await renderInvoice(vm('01-simple-19-en16931'), opts);
    expect(a.pdf.length).toBe(b.pdf.length);
    let diff = 0;
    for (let i = 0; i < a.pdf.length; i++) if (a.pdf[i] !== b.pdf[i]) diff++;
    expect(diff).toBeLessThan(80);
  });
});
