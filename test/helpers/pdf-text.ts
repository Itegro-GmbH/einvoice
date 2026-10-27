/**
 * Test helper: extract the page texts of a PDF with pdfjs-dist (Node, without a worker).
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function pageTexts(pdf: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, disableFontFace: true }).promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    texts.push(content.items.map((it) => ('str' in it ? it.str : '')).join('\n'));
  }
  await doc.cleanup();
  return texts;
}
