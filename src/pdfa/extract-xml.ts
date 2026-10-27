/**
 * Reads the embedded invoice XML from a (Factur-X/ZUGFeRD) PDF: first via `/AF` in the catalog,
 * otherwise via the `Names/EmbeddedFiles` tree. Prefers `factur-x.xml`, also accepts
 * `zugferd-invoice.xml` (legacy ZUGFeRD 1.0/2.0) and `xrechnung.xml`. `null` if no attachment is present.
 */
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFStream, PDFString } from 'pdf-lib';

export interface ExtractedXml {
  xml: string;
  filename: string;
}

export const KNOWN_XML_NAMES = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml', 'ZUGFeRD-invoice.xml'] as const;

function specName(spec: PDFDict): string | undefined {
  const v = spec.get(PDFName.of('UF')) ?? spec.get(PDFName.of('F'));
  return v instanceof PDFHexString || v instanceof PDFString ? v.decodeText() : undefined;
}

function collectSpecs(doc: PDFDocument): PDFDict[] {
  const specs: PDFDict[] = [];
  const af = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  if (af !== undefined) {
    for (let i = 0; i < af.size(); i++) {
      const d = af.lookupMaybe(i, PDFDict);
      if (d !== undefined) specs.push(d);
    }
  }
  const names = doc.catalog
    .lookupMaybe(PDFName.of('Names'), PDFDict)
    ?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
    ?.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (names !== undefined) {
    for (let i = 1; i < names.size(); i += 2) {
      const d = names.lookupMaybe(i, PDFDict);
      if (d !== undefined && !specs.includes(d)) specs.push(d);
    }
  }
  return specs;
}

export async function extractXml(pdf: Uint8Array): Promise<ExtractedXml | null> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false, ignoreEncryption: true });
  const specs = collectSpecs(doc).map((spec) => ({ spec, name: specName(spec) }));
  const preferred = KNOWN_XML_NAMES.map((n) => specs.find((s) => s.name === n)).find((s) => s !== undefined);
  const chosen = preferred ?? specs.find((s) => s.name?.toLowerCase().endsWith('.xml') === true);
  if (chosen === undefined || chosen.name === undefined) return null;
  const ef = chosen.spec.lookupMaybe(PDFName.of('EF'), PDFDict);
  const stream = ef?.lookup(PDFName.of('UF')) ?? ef?.lookup(PDFName.of('F'));
  if (!(stream instanceof PDFStream)) return null;
  const bytes = decodePDFRawStream(stream as Parameters<typeof decodePDFRawStream>[0]).decode();
  return { xml: Buffer.from(bytes).toString('utf8'), filename: chosen.name };
}
