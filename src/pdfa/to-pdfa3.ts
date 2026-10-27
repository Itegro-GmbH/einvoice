/**
 * PDF/A-3B post-processing with pdf-lib (veraPDF-checked):
 *   1. Info dict (Title/Author/Subject/Creator/Producer/CreationDate/ModDate), the source of truth,
 *   2. XMP metadata stream (uncompressed): pdfaid:part=3/conformance=B, dc/xmp/pdf, Factur-X
 *      extension schema, fx:DocumentType/DocumentFileName/Version/ConformanceLevel per profile,
 *   3. OutputIntent GTS_PDFA1 with an sRGB ICC profile (assets/icc),
 *   4. factur-x.xml as an embedded file (AFRelationship=Alternative, text/xml, name tree + /AF, done by `attach`),
 *   5. trailer/ID from `documentId` (hash of the input), no object streams.
 *
 * Determinism (GoBD): every timestamp comes from `meta.creationDate`, the ID from the caller; no `new Date()`.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { AFRelationship, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, type PDFContext } from 'pdf-lib';
import type { Profile } from '../model/input.js';
import { packagePath } from '../package-paths.js';

export const XML_FILENAME = 'factur-x.xml';
export const CREATOR = '@itegro/einvoice (react-pdf)';
export const PRODUCER = '@itegro/einvoice (pdf-lib, PDF/A-3B)';

/** `fx:ConformanceLevel` per profile (Factur-X 1.0 / ZUGFeRD 2.x XMP-Schema). */
export const CONFORMANCE_LEVELS: Readonly<Record<Profile, string>> = {
  basic: 'BASIC',
  en16931: 'EN 16931',
  extended: 'EXTENDED',
  xrechnung: 'XRECHNUNG',
};

const ICC_PATH = packagePath('assets', 'icc', 'sRGB-v2-magic.icc');
let iccCache: Uint8Array | undefined;
function icc(): Uint8Array {
  iccCache ??= new Uint8Array(fs.readFileSync(ICC_PATH));
  return iccCache;
}

export interface PdfMeta {
  title: string;
  author: string;
  subject: string;
  /** CreationDate = ModDate; normally `issueDate` 00:00:00 UTC or an explicit `createdAt`. */
  creationDate: Date;
  invoiceNumber: string;
}

export interface PdfA3Options {
  xml: string;
  profile: Profile;
  meta: PdfMeta;
  /** 32 hex characters (16 bytes), see `documentId()`. */
  documentId: string;
}

/** 16-byte document ID as SHA-256 over the length-prefixed parts (XML, options JSON, template version, ...). */
export function documentId(parts: readonly (string | Uint8Array)[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    const bytes = typeof p === 'string' ? Buffer.from(p, 'utf8') : p;
    h.update(`${String(bytes.byteLength)}:`);
    h.update(bytes);
  }
  return h.digest('hex').slice(0, 32).toUpperCase();
}

const escXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** ISO 8601 in UTC with `Z`, second precision (XMP date format). */
export function xmpDate(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

const FX_PROPERTIES: readonly [string, string][] = [
  ['DocumentFileName', 'name of the embedded XML invoice file'],
  ['DocumentType', 'The type of the hybrid document in capital letters, e.g. INVOICE or ORDER'],
  ['Version', 'The actual version of the Factur-X XML schema'],
  ['ConformanceLevel', 'The conformance level of the embedded Factur-X data'],
];

export function buildXmp(o: PdfA3Options & { producer: string; creator: string }): string {
  const date = xmpDate(o.meta.creationDate);
  const fxProps = FX_PROPERTIES.map(
    ([n, d]) => `
            <rdf:li rdf:parseType="Resource">
              <pdfaProperty:name>${n}</pdfaProperty:name>
              <pdfaProperty:valueType>Text</pdfaProperty:valueType>
              <pdfaProperty:category>external</pdfaProperty:category>
              <pdfaProperty:description>${d}</pdfaProperty:description>
            </rdf:li>`,
  ).join('');
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escXml(o.meta.title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${escXml(o.meta.author)}</rdf:li></rdf:Seq></dc:creator>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escXml(o.meta.subject)}</rdf:li></rdf:Alt></dc:description>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>${escXml(o.creator)}</xmp:CreatorTool>
      <xmp:CreateDate>${date}</xmp:CreateDate>
      <xmp:ModifyDate>${date}</xmp:ModifyDate>
      <xmp:MetadataDate>${date}</xmp:MetadataDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>${escXml(o.producer)}</pdf:Producer>
      <pdf:PDFVersion>1.7</pdf:PDFVersion>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${fxProps}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${XML_FILENAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${CONFORMANCE_LEVELS[o.profile]}</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** Deletes every indirect object a dict points to, and removes the entries (values are set again afterwards). */
function dropIndirectValues(ctx: PDFContext, dict: PDFDict | undefined): void {
  if (dict === undefined) return;
  for (const [key, value] of dict.entries()) {
    if (value instanceof PDFRef) {
      ctx.delete(value);
      dict.delete(key);
    }
  }
}

export async function toPdfA3(basePdf: Uint8Array, o: PdfA3Options): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(basePdf, { updateMetadata: false });
  const ctx = pdfDoc.context;
  const { meta } = o;

  // 0) Remove leftovers from the renderer: pdfkit writes the info values (Producer, Creator,
  //    CreationDate = rendering's system time, Title) as their own indirect objects and possibly
  //    an XMP stream. pdf-lib only replaces the dict entries; the old objects would stay behind as
  //    orphans in the file, with CreationDate at second resolution (-> two runs only byte-identical
  //    within the same second). So delete them here before the values are set again.
  dropIndirectValues(ctx, ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict));
  const oldMetadata = pdfDoc.catalog.get(PDFName.of('Metadata'));
  if (oldMetadata instanceof PDFRef) ctx.delete(oldMetadata);

  // 1) Info dict
  pdfDoc.setTitle(meta.title);
  pdfDoc.setAuthor(meta.author);
  pdfDoc.setSubject(meta.subject);
  pdfDoc.setCreator(CREATOR);
  pdfDoc.setProducer(PRODUCER);
  pdfDoc.setCreationDate(meta.creationDate);
  pdfDoc.setModificationDate(meta.creationDate);
  pdfDoc.setKeywords(['Rechnung', 'Factur-X', 'ZUGFeRD', 'EN 16931', meta.invoiceNumber]);

  // 2) XMP (uncompressed, Type/Subtype set)
  const xmp = buildXmp({ ...o, producer: PRODUCER, creator: CREATOR });
  const xmpStream = ctx.stream(Buffer.from(xmp, 'utf8'), { Type: 'Metadata', Subtype: 'XML' });
  pdfDoc.catalog.set(PDFName.of('Metadata'), ctx.register(xmpStream));

  // 3) OutputIntent sRGB
  const iccRef = ctx.register(ctx.flateStream(icc(), { N: 3 }));
  const outputIntent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB'),
    RegistryName: PDFString.of('http://www.color.org'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: iccRef,
  });
  pdfDoc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(outputIntent)]));

  // 4) factur-x.xml (name tree + /AF handled by pdf-lib)
  await pdfDoc.attach(Buffer.from(o.xml, 'utf8'), XML_FILENAME, {
    mimeType: 'text/xml',
    description: `Factur-X/ZUGFeRD invoice (${CONFORMANCE_LEVELS[o.profile]})`,
    creationDate: meta.creationDate,
    modificationDate: meta.creationDate,
    afRelationship: AFRelationship.Alternative,
  });

  // 5) Trailer ID (two identical IDs for a newly created document)
  const id = PDFHexString.of(o.documentId);
  ctx.trailerInfo.ID = ctx.obj([id, id]);

  return pdfDoc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
