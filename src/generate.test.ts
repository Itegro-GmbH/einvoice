import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { generate, generateXml, extractXml, InvoiceError } from './index.js';
import { loadFixture, longInvoice, PNG_1X1 } from '../test/helpers/fixtures.js';
import { pageTexts } from '../test/helpers/pdf-text.js';
import { expectSameBytes } from '../test/helpers/byte-diff.js';

function jpeg(): Buffer {
  const c = createCanvas(8, 8);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 8, 8);
  return c.toBuffer('image/jpeg');
}

/** Baseline JPEG with the component count in the SOF0 marker patched to 4 (a CMYK stand-in for the header check). */
function cmykJpeg(): Buffer {
  const b = Buffer.from(jpeg());
  for (let i = 0; i < b.length - 9; i++) {
    if (b[i] === 0xff && b[i + 1] === 0xc0) {
      b[i + 9] = 4;
      return b;
    }
  }
  throw new Error('no SOF0');
}

describe('generate()', () => {
  it('returns xml, pdf, warnings, profile, meta; XML identical to generateXml; PDF is PDF/A-3 structured', async () => {
    const input = loadFixture('01-simple-19-en16931');
    const r = await generate(input);
    const x = await generateXml(input);
    expect(r.xml).toBe(x.xml);
    expect(r.warnings).toEqual(x.warnings);
    expect(r.profile).toBe('en16931');
    expect(Buffer.from(r.pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(r.meta.pages).toBe(1);
    expect(r.meta.xmlBytes).toBe(Buffer.byteLength(r.xml, 'utf8'));
    expect(r.meta.pdfBytes).toBe(r.pdf.byteLength);
    expect(Object.keys(r.meta.durationMs).sort()).toEqual(['pdfa', 'render', 'schematron', 'serialize', 'validate']);
    expect(r.meta.durationMs.schematron).toBeGreaterThan(0);
    expect(r.meta.durationMs.render).toBeGreaterThan(0);
    const raw = Buffer.from(r.pdf).toString('latin1');
    expect(raw).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(raw).toContain('/CreationDate (D:20260912000000Z)');
    expect(raw).toContain('/AFRelationship /Alternative');
  });

  it('extractXml-Roundtrip: embedded XML byte-identical to the xml return value', async () => {
    const r = await generate(loadFixture('09-xrechnung'), { skipXmlValidation: true });
    const e = await extractXml(r.pdf);
    expect(e?.filename).toBe('factur-x.xml');
    expect(e?.xml).toBe(r.xml);
    expect(Buffer.from(r.pdf).toString('latin1')).toContain('<fx:ConformanceLevel>XRECHNUNG</fx:ConformanceLevel>');
  });

  it('is byte-deterministic: calling generate() twice with the same input → identical PDF', async () => {
    const input = loadFixture('02-mixed-7-19-allowance-en16931');
    const a = await generate(input, { skipXmlValidation: true, template: { template: 'modern', accentColor: '#AA3311' } });
    const b = await generate(input, { skipXmlValidation: true, template: { template: 'modern', accentColor: '#aa3311' } });
    expectSameBytes(a.pdf, b.pdf, 'generate-twice');
  });

  it('is byte-deterministic under load: five concurrent (Promise.all) and five sequential calls → 10 identical PDFs', async () => {
    const input = loadFixture('02-mixed-7-19-allowance-en16931');
    const run = () => generate(input, { skipXmlValidation: true, template: { template: 'modern', accentColor: '#aa3311' } });
    const parallel = await Promise.all([run(), run(), run(), run(), run()]);
    const sequential = [];
    for (let i = 0; i < 5; i++) sequential.push(await run());
    const all = [...parallel, ...sequential];
    all.forEach((r, i) => expectSameBytes(all[0]!.pdf, r.pdf, `generate-10x-${String(i)}`));
  });

  it.each(['minimal', 'elegant'] as const)(
    'is byte-deterministic for template %s: calling generate() twice with the same input → identical PDF',
    async (template) => {
      const input = loadFixture('02-mixed-7-19-allowance-en16931');
      const a = await generate(input, { skipXmlValidation: true, template: { template, accentColor: '#a8481e' } });
      const b = await generate(input, { skipXmlValidation: true, template: { template, accentColor: '#a8481e' } });
      expectSameBytes(a.pdf, b.pdf, `generate-twice-${template}`);
    },
  );

  describe('independent of the system time', () => {
    afterEach(() => vi.useRealTimers());

    it('system time shifted by one hour → identical PDF', async () => {
      const input = loadFixture('01-simple-19-en16931');
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-12T10:15:30.123Z'));
      const a = await generate(input, { skipXmlValidation: true });
      vi.setSystemTime(new Date('2026-09-12T11:15:30.456Z'));
      const b = await generate(input, { skipXmlValidation: true });
      expectSameBytes(a.pdf, b.pdf, 'generate-clock-shift');
      const raw = Buffer.from(a.pdf).toString('latin1');
      expect(raw).not.toContain('D:20260912101530');
      expect(raw).not.toContain('2026-09-12T10:15:30');
    });
  });

  it('different template options or watermark → different document ID', async () => {
    const input = loadFixture('01-simple-19-en16931');
    const id = (pdf: Uint8Array) => /\/ID \[ <([0-9A-F]{32})>/.exec(Buffer.from(pdf).toString('latin1'))?.[1];
    const a = await generate(input, { skipXmlValidation: true });
    const b = await generate(input, { skipXmlValidation: true, template: { template: 'modern' } });
    const c = await generate(input, { skipXmlValidation: true, watermark: 'TEST' });
    expect(id(a.pdf)).toBeDefined();
    expect(new Set([id(a.pdf), id(b.pdf), id(c.pdf)]).size).toBe(3);
  });

  it('60 line items → multiple pages, roundtrip ok', async () => {
    const r = await generate(longInvoice(60), { skipXmlValidation: true });
    expect(r.meta.pages).toBeGreaterThanOrEqual(2);
    expect((await extractXml(r.pdf))?.xml).toBe(r.xml);
  });

  it('options: watermark, createdAt, skipXmlValidation, logo', async () => {
    const r = await generate(loadFixture('01-simple-19-en16931'), {
      skipXmlValidation: true,
      watermark: 'TESTMODUS',
      createdAt: new Date('2026-10-01T12:34:56Z'),
      template: { logo: { data: PNG_1X1, mime: 'image/png' }, footerText: 'Fußtext' },
    });
    expect(r.meta.durationMs.schematron).toBe(0);
    const raw = Buffer.from(r.pdf).toString('latin1');
    expect(raw).toContain('/CreationDate (D:20261001123456Z)');
    expect(raw).toContain('<xmp:CreateDate>2026-10-01T12:34:56Z</xmp:CreateDate>');
    const [p1] = await pageTexts(r.pdf);
    expect(p1).toContain('TESTMODUS');
    expect(p1).toContain('Fußtext');
    const j = await generate(loadFixture('01-simple-19-en16931'), { skipXmlValidation: true, template: { logo: { data: jpeg(), mime: 'image/jpeg' } } });
    expect(Buffer.from(j.pdf).toString('latin1')).toContain('/Filter /DCTDecode');
  });

  it('invalid template options → InvoiceError IF-TEMPLATE-001; CMYK JPEG → IF-TEMPLATE-002', async () => {
    await expect(generate(loadFixture('01-simple-19-en16931'), { template: { accentColor: 'rot' } })).rejects.toMatchObject({
      name: 'InvoiceError',
      violations: [{ rule: 'IF-TEMPLATE-001', path: 'template.accentColor' }],
    });
    const err = await generate(loadFixture('01-simple-19-en16931'), { template: { logo: { data: cmykJpeg(), mime: 'image/jpeg' } } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvoiceError);
    expect((err as InvoiceError).violations[0]).toMatchObject({ rule: 'IF-TEMPLATE-002', path: 'template.logo.data' });
  });

  it('business violations are still thrown as InvoiceError (before rendering)', async () => {
    await expect(generate({ ...loadFixture('01-simple-19-en16931'), lines: [] })).rejects.toBeInstanceOf(InvoiceError);
  });
});
