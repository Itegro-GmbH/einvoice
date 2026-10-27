import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { calculate } from '../calculate/index.js';
import { normalize } from '../normalize/index.js';
import { serializeCii } from '../serialize/index.js';
import { renderInvoice } from '../render/render.js';
import { TemplateOptionsSchema } from '../render/template-options.js';
import { toViewModel } from '../render/view-model.js';
import { loadFixture } from '../../test/helpers/fixtures.js';
import { expectSameBytes } from '../../test/helpers/byte-diff.js';
import { toPdfA3, buildXmp, CONFORMANCE_LEVELS, documentId, type PdfA3Options } from './to-pdfa3.js';
import { extractXml } from './extract-xml.js';

async function base(name = '01-simple-19-en16931') {
  const calculated = calculate(normalize(loadFixture(name)));
  const xml = serializeCii(calculated);
  const { pdf } = await renderInvoice(toViewModel(calculated), { template: TemplateOptionsSchema.parse({}) });
  return { calculated, xml, pdf };
}

function opts(xml: string, overrides: Partial<PdfA3Options> = {}): PdfA3Options {
  return {
    xml,
    profile: 'en16931',
    meta: { title: 'Rechnung RE-2026-00001', author: 'Musterwerk GmbH', subject: 'Rechnung RE-2026-00001 vom 12.09.2026', creationDate: new Date('2026-09-12T00:00:00Z'), invoiceNumber: 'RE-2026-00001' },
    documentId: documentId(['a', 'b']),
    ...overrides,
  };
}

describe('toPdfA3', () => {
  it('adds XMP (pdfaid 3/B, Factur-X schema), OutputIntent, factur-x.xml attachment as /AF, consistent info dict', async () => {
    const { xml, pdf } = await base();
    const out = await toPdfA3(pdf, opts(xml));
    const raw = Buffer.from(out).toString('latin1');
    expect(raw).toContain('/Type /Metadata');
    expect(raw).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(raw).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(raw).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>');
    expect(raw).toContain('<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>');
    expect(raw).toContain('<fx:DocumentType>INVOICE</fx:DocumentType>');
    expect(raw).toContain('/S /GTS_PDFA1');
    expect(raw).toContain('/AFRelationship /Alternative');
    expect(raw).toContain('/EmbeddedFiles');
    expect(raw).toContain('/CreationDate (D:20260912000000Z)');
    expect(raw).toContain('/ModDate (D:20260912000000Z)');
    expect(raw).toContain('<xmp:CreateDate>2026-09-12T00:00:00Z</xmp:CreateDate>');
    expect(raw).toContain('<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Rechnung RE-2026-00001</rdf:li></rdf:Alt></dc:title>');
    expect(raw).not.toContain('/Producer (react-pdf)');

    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getTitle()).toBe('Rechnung RE-2026-00001');
    expect(doc.getAuthor()).toBe('Musterwerk GmbH');
    expect(doc.getCreationDate()?.toISOString()).toBe('2026-09-12T00:00:00.000Z');
    expect(doc.catalog.has(PDFName.of('AF'))).toBe(true);
    expect(doc.getPageCount()).toBe(1);
  });

  it('fx:ConformanceLevel per profile', () => {
    expect(CONFORMANCE_LEVELS).toEqual({ basic: 'BASIC', en16931: 'EN 16931', extended: 'EXTENDED', xrechnung: 'XRECHNUNG' });
    const xmp = buildXmp({ ...opts('<x/>', { profile: 'xrechnung' }), producer: 'p', creator: 'c' });
    expect(xmp).toContain('<fx:ConformanceLevel>XRECHNUNG</fx:ConformanceLevel>');
    expect(xmp).toContain('<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>');
    expect(xmp.startsWith('<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>')).toBe(true);
  });

  it('XML special characters in metadata are escaped', () => {
    const xmp = buildXmp({ ...opts('<x/>', { meta: { title: 'A & B <C>', author: 'x', subject: 'y', creationDate: new Date(0), invoiceNumber: '1' } }), producer: 'p', creator: 'c' });
    expect(xmp).toContain('A &amp; B &lt;C&gt;');
  });

  it('is byte-deterministic: post-processing twice → identical; also from two separate renderings', async () => {
    const { xml, pdf, calculated } = await base();
    const a = await toPdfA3(pdf, opts(xml));
    const b = await toPdfA3(pdf, opts(xml));
    expectSameBytes(a, b, 'pdfa-same-base');
    const { pdf: pdf2 } = await renderInvoice(toViewModel(calculated), { template: TemplateOptionsSchema.parse({}) });
    const c = await toPdfA3(pdf2, opts(xml));
    expectSameBytes(a, c, 'pdfa-two-renderings');
    const raw = Buffer.from(a).toString('latin1');
    const id = documentId(['a', 'b']);
    expect(raw).toContain(`/ID [ <${id}> <${id}> ]`);
  });

  it('contains no foreign timestamps: every PDF date is creationDate; react-pdf info objects are not orphaned', async () => {
    const { xml, pdf } = await base();
    const raw = Buffer.from(await toPdfA3(pdf, opts(xml))).toString('latin1');
    // pdfkit writes its info dict (Producer, Creator, CreationDate = new Date(), Title) as indirect objects;
    // pdf-lib only replaces the dict entries; the old objects would stay behind as orphans with a system timestamp in the file.
    const dates = raw.match(/D:\d{14}/g) ?? [];
    expect(dates.length).toBeGreaterThanOrEqual(2);
    expect(new Set(dates)).toEqual(new Set(['D:20260912000000']));
    expect(raw).not.toMatch(/\n\(react-pdf\)\nendobj/);
    expect(raw).not.toContain('(Rechnung RE-2026-00001)\nendobj');
  });

  it('documentId: SHA-256 of the parts, 16-byte hex, stable', () => {
    expect(documentId(['a', 'b'])).toMatch(/^[0-9A-F]{32}$/);
    expect(documentId(['a', 'b'])).toBe(documentId(['a', 'b']));
    expect(documentId(['a', 'b'])).not.toBe(documentId(['a', 'c']));
    expect(documentId(['ab'])).not.toBe(documentId(['a', 'b']));
  });
});

describe('extractXml', () => {
  it('reads factur-x.xml back byte-identically', async () => {
    const { xml, pdf } = await base('02-mixed-7-19-allowance-en16931');
    const out = await toPdfA3(pdf, opts(xml));
    const r = await extractXml(out);
    expect(r).not.toBeNull();
    expect(r!.filename).toBe('factur-x.xml');
    expect(r!.xml).toBe(xml);
    expect(Buffer.from(r!.xml, 'utf8').length).toBe(Buffer.from(xml, 'utf8').length);
  });

  it('returns null for a PDF without an attachment', async () => {
    const { pdf } = await base();
    expect(await extractXml(pdf)).toBeNull();
  });
});
