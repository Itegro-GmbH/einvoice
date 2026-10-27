/**
 * Header check for logos before rendering. PDF/A traps: a JPEG with 4 components (CMYK/YCCK)
 * ends up as DeviceCMYK without a CMYK OutputIntent in the PDF (veraPDF 6.2.4.3); the format
 * must match the declared MIME type (pdfkit otherwise decodes it incorrectly).
 */
import type { Violation } from '../errors/index.js';

export interface ImageInfo {
  format: 'png' | 'jpeg';
  /** Color components (JPEG: from SOF; PNG: from the color type). */
  components: number;
  /** PNG: alpha channel (SMask in the PDF, allowed in PDF/A-3). */
  alpha: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function inspectImage(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes.length >= 29 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    const colorType = bytes[25] ?? 0;
    // 0 gray, 2 RGB, 3 palette, 4 gray+alpha, 6 RGB+alpha
    const components = colorType === 2 || colorType === 6 ? 3 : 1;
    return { format: 'png', components, alpha: colorType === 4 || colorType === 6 };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return undefined;
      const marker = bytes[i + 1] ?? 0;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
        i += marker === 0xff ? 1 : 2;
        continue;
      }
      const len = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { format: 'jpeg', components: bytes[i + 9] ?? 0, alpha: false };
      if (marker === 0xda) return undefined; // scan without SOF
      i += 2 + len;
    }
  }
  return undefined;
}

/** Checks a logo against its MIME type and PDF/A traps; returns violations with path `template.logo.*`. */
export function checkLogo(logo: { data: Uint8Array; mime: 'image/png' | 'image/jpeg' }): Violation[] {
  const info = inspectImage(logo.data);
  const expected = logo.mime === 'image/png' ? 'png' : 'jpeg';
  if (info === undefined || info.format !== expected) {
    return [
      {
        rule: 'IF-TEMPLATE-002',
        path: 'template.logo.data',
        message: `Logo data is not a valid ${expected.toUpperCase()} (MIME ${logo.mime}).`,
        hint: 'Only PNG (RGB/gray/palette, alpha optional) and baseline JPEG (RGB/gray) are supported.',
      },
    ];
  }
  if (info.format === 'jpeg' && info.components === 4) {
    return [
      {
        rule: 'IF-TEMPLATE-002',
        path: 'template.logo.data',
        message: 'The JPEG logo has 4 color components (CMYK/YCCK); not allowed in PDF/A-3 without a CMYK OutputIntent.',
        hint: 'Export the logo as an RGB JPEG or PNG.',
      },
    ];
  }
  return [];
}
