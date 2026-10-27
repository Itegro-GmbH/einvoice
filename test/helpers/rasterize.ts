/**
 * PDF → PNG (one page) for visual snapshot tests: pdfjs-dist (legacy build) + @napi-rs/canvas (prebuilt
 * binaries, no native toolchain). `disableFontFace: true` makes pdfjs draw the embedded glyphs as paths,
 * independent of system fonts and byte-identical on the same machine (two runs → same PNG bytes).
 * Returns `undefined` if the rasterizer cannot be loaded (the test then skips itself).
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface Rasterizer {
  name: string;
  render(pdf: Uint8Array, page: number, scale: number): Promise<Buffer>;
}

let cached: Rasterizer | null | undefined;

export async function getRasterizer(): Promise<Rasterizer | undefined> {
  if (cached !== undefined) return cached ?? undefined;
  try {
    const { createCanvas } = await import('@napi-rs/canvas');
    cached = {
      name: `pdfjs-dist ${pdfjs.version} + @napi-rs/canvas`,
      async render(pdf, page, scale) {
        const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, disableFontFace: true }).promise;
        try {
          const p = await doc.getPage(page);
          const viewport = p.getViewport({ scale });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          // pdfjs expects DOM types (without the DOM lib, `any`); @napi-rs/canvas is API-compatible.
          await p.render({ canvas: null, canvasContext: ctx, viewport }).promise;
          return canvas.toBuffer('image/png');
        } finally {
          await doc.cleanup();
        }
      },
    };
  } catch {
    cached = null;
  }
  return cached ?? undefined;
}
