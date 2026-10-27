/**
 * Fonts for react-pdf, registered once per process, from `assets/fonts/`. No standard-14 font may appear in the
 * document (PDF/A: all fonts embedded), which is why every `Page` explicitly gets a `fontFamily`.
 * Hyphenation is switched off (determinism, no hyphens in IBANs).
 */
import { Font } from '@react-pdf/renderer';
import { packagePath } from '../package-paths.js';

/** Sans-serif base font: all templates (body text, tables, footer). */
export const FONT_FAMILY = 'DejaVu';
/** Serif font for the `elegant` template (headings, invoice number, totals; see `templates/elegant.ts`). */
export const FONT_FAMILY_SERIF = 'PTSerif';

const fontFile = (name: string): string => packagePath('assets', 'fonts', name);

let registered = false;

/** Idempotent: registers both families and the hyphenation callback exactly once. */
export function ensureFonts(): void {
  if (registered) return;
  Font.register({
    family: FONT_FAMILY,
    fonts: [
      { src: fontFile('DejaVuSans.ttf'), fontWeight: 'normal' },
      { src: fontFile('DejaVuSans-Bold.ttf'), fontWeight: 'bold' },
    ],
  });
  Font.register({
    family: FONT_FAMILY_SERIF,
    fonts: [
      { src: fontFile('PTSerif-Regular.ttf'), fontWeight: 'normal' },
      { src: fontFile('PTSerif-Bold.ttf'), fontWeight: 'bold' },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
