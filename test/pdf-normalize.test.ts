/**
 * Unit tests for `helpers/pdf-normalize.ts` : the normalization must make PDFs that differ only
 * in the deflate encoding (here: zlib level 1 vs 9, standing in for two zlib builds) equal, while
 * every real difference stays visible.
 */
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { normalizePdf } from './helpers/pdf-normalize.js';

/** Builds a minimal, structurally valid PDF whose single content stream is deflated at `level`. */
function buildPdf(content: string, level: number, extraDict = ''): Buffer {
  const body = zlib.deflateSync(Buffer.from(content, 'latin1'), { level });
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Buffer | string): void => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    chunks.push(buf);
    pos += buf.length;
  };
  push('%PDF-1.7\n');
  offsets.push(pos);
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offsets.push(pos);
  push('2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n');
  offsets.push(pos);
  push(`3 0 obj\n<<\n/Length ${String(body.length)}\n/Filter /FlateDecode\n${extraDict}>>\nstream\n`);
  push(body);
  push('\nendstream\nendobj\n');
  const xrefAt = pos;
  push(`xref\n0 4\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${String(xrefAt)}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

const CONTENT = `BT /F1 12 Tf 72 700 Td (${'Hello Rechnung 1234567890 '.repeat(200)}) Tj ET`;

describe('normalizePdf ', () => {
  it('maps PDFs that differ only in the deflate encoding to identical bytes', () => {
    const fast = buildPdf(CONTENT, 1);
    const best = buildPdf(CONTENT, 9);
    expect(Buffer.compare(fast, best), 'precondition: raw bytes must differ').not.toBe(0);

    const a = normalizePdf(fast);
    const b = normalizePdf(best);
    expect(a.inflatedStreams).toBe(1);
    expect(a.totalStreams).toBe(1);
    expect(Buffer.compare(a.bytes, b.bytes)).toBe(0);
  });

  it('keeps a change in the decompressed content visible', () => {
    const a = normalizePdf(buildPdf(CONTENT, 6));
    const b = normalizePdf(buildPdf(CONTENT.replace('Hello', 'Hallo'), 6));
    expect(Buffer.compare(a.bytes, b.bytes)).not.toBe(0);
  });

  it('keeps a change in a stream dictionary visible', () => {
    const a = normalizePdf(buildPdf(CONTENT, 6));
    const b = normalizePdf(buildPdf(CONTENT, 6, '/Subtype /Form\n'));
    expect(Buffer.compare(a.bytes, b.bytes)).not.toBe(0);
  });

  it('throws on a corrupt flate stream instead of skipping it', () => {
    const pdf = buildPdf(CONTENT, 6);
    const at = pdf.indexOf('stream\n') + 'stream\n'.length;
    pdf[at + 4] = (pdf[at + 4] ?? 0) ^ 0xff;
    pdf[at + 5] = (pdf[at + 5] ?? 0) ^ 0xff;
    expect(() => normalizePdf(pdf)).toThrow();
  });
});
