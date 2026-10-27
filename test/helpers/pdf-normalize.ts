/**
 * Test helper: reduce a PDF to a form that does not depend on the zlib build that produced it.
 *
 * Why this exists : the PDF
 * writers in the render path (react-pdf/pdfkit for page content and fonts, pdf-lib for the
 * PDF/A-3B post-processing) compress streams with the zlib that ships inside the running Node
 * binary. Different zlib builds (for example Node 26 on macOS, linked against the system zlib
 * 1.2.12, versus Node 24 on Linux, which bundles the Chromium zlib fork 1.3.x) turn the same input
 * into *different but equally valid* deflate bytes, so two PDFs that are identical in every
 * observable respect are not byte-identical. Linux x64 and Linux arm64 on the same Node produce
 * identical bytes; the variation is the zlib build, not the CPU or the operating system.
 *
 * Normalization, applied to the raw file bytes (no PDF object model needed, the writers emit
 * plain `N 0 obj << ... >> stream ... endstream` objects without object streams):
 *   1. every `/FlateDecode` stream body is replaced by its inflated bytes (a stream that fails
 *      to inflate throws, it is never skipped);
 *   2. every direct `/Length n` in a stream dictionary becomes `/Length *`, because the encoded
 *      length is exactly what differs;
 *   3. the classic cross-reference table and the `startxref` offset become `*`, because they
 *      are derived from the (now irrelevant) encoded object lengths.
 * Everything else, including object order and numbering, every dictionary, the trailer `/ID`,
 * the XMP packet, embedded files and the inflated content/font/image streams, is compared byte
 * for byte. A template change, a font change, a `TEMPLATE_VERSION` bump or an option change
 * therefore still changes the normalized bytes.
 */
import zlib from 'node:zlib';

export interface NormalizedPdf {
  /** The normalized bytes (latin1-safe: 1 byte per char in, 1 byte per char out). */
  bytes: Buffer;
  /** How many `/FlateDecode` streams were inflated; lets callers assert the normalizer did real work. */
  inflatedStreams: number;
  /** Total number of streams seen. */
  totalStreams: number;
}

const STREAM_OPEN = /stream\r?\n/g;

export function normalizePdf(pdf: Uint8Array): NormalizedPdf {
  const buf = Buffer.from(pdf);
  const text = buf.toString('latin1');
  const parts: Buffer[] = [];
  let cursor = 0;
  let inflatedStreams = 0;
  let totalStreams = 0;

  STREAM_OPEN.lastIndex = 0;
  for (let match = STREAM_OPEN.exec(text); match !== null; match = STREAM_OPEN.exec(text)) {
    // Only a `stream` keyword that closes a dictionary starts a stream body (`endstream` and the
    // word inside binary data are skipped by this check or by the cursor advancing past bodies).
    if (match.index < cursor) continue;
    const dictEnd = text.lastIndexOf('>>', match.index);
    const between = text.slice(dictEnd + 2, match.index);
    if (dictEnd < cursor || between.trim() !== '') continue;
    const dictStart = text.lastIndexOf(' obj', dictEnd);
    const dict = text.slice(dictStart, dictEnd + 2);

    const lengthMatch = /\/Length (\d+)(?! \d+ R)/.exec(dict);
    if (lengthMatch?.[1] === undefined) {
      throw new Error(`stream dictionary without a direct /Length: ${dict.slice(0, 120)}`);
    }
    const length = Number(lengthMatch[1]);
    const bodyStart = match.index + match[0].length;
    const body = buf.subarray(bodyStart, bodyStart + length);
    if (text.slice(bodyStart + length).search(/^\s*endstream/) !== 0) {
      throw new Error(`stream body at ${String(bodyStart)} is not followed by endstream (wrong /Length?)`);
    }

    totalStreams++;
    let outBody: Buffer = body;
    if (dict.includes('/FlateDecode')) {
      outBody = zlib.inflateSync(body);
      inflatedStreams++;
    }

    parts.push(Buffer.from(text.slice(cursor, dictStart) + dict.replace(/\/Length \d+/, '/Length *') + text.slice(dictEnd + 2, bodyStart), 'latin1'));
    parts.push(outBody);
    cursor = bodyStart + length;
  }
  // The cross-reference table sits after the last stream, so only the tail is rewritten (inflated
  // stream bodies are never touched by these patterns).
  const tail = text
    .slice(cursor)
    .replace(/\nxref\r?\n[\s\S]*?\ntrailer/, '\nxref\n*\ntrailer')
    .replace(/startxref\r?\n\d+/, 'startxref\n*');
  parts.push(Buffer.from(tail, 'latin1'));
  const joined = Buffer.concat(parts);
  return { bytes: joined, inflatedStreams, totalStreams };
}
