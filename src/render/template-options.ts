/**
 * Template options (Zod). Initial parameters (logo and accent color first). Further parameters are added as additional keys, without a rework,
 * because templates receive the parsed object as a whole and `TEMPLATE_VERSION` feeds into the
 * document ID.
 */
import { z } from 'zod';
import { InvoiceError, formatPath, type Violation } from '../errors/index.js';

/**
 * Bumped on every visible layout change that alters the PDF output of any template; feeds into
 * the trailer ID (reproducibility, GoBD). Kept globally rather than per template;
 *  Version `2` added the `minimal` and `elegant` templates and fixed the info block and footer of
 * `classic`/`modern`.
 */
export const TEMPLATE_VERSION = '2';

export const TEMPLATE_NAMES = ['classic', 'modern', 'minimal', 'elegant'] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

/**
 * Short English description per built-in template . English
 * because this is served by the public API; the German marketing gallery at `/vorlagen`
 * (`modules/templates-gallery`) uses its own German i18n texts instead.
 */
export const TEMPLATE_DESCRIPTIONS: Readonly<Record<TemplateName, string>> = {
  classic: 'Classic business letter per DIN 5008 in black/gray with a subtle accent line.',
  modern: 'Compact footer, accent color as a header bar and table header.',
  minimal: 'Generous white space, hairlines only, accent color used solely for the amount due.',
  elegant: 'Serif typeface for headings and totals, a fine double line, a calm letter character.',
};

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const logoData = z
  .union([z.custom<Uint8Array>((v) => v instanceof Uint8Array, 'Expected a Uint8Array.'), z.string().min(1)])
  .transform((v, ctx) => {
    if (typeof v !== 'string') return v;
    const compact = v.replace(/\s+/g, '');
    if (compact.length % 4 !== 0 || !BASE64.test(compact)) {
      ctx.addIssue({ code: 'custom', message: 'Logo data must be base64 or a Uint8Array.' });
      return z.NEVER;
    }
    return new Uint8Array(Buffer.from(compact, 'base64'));
  })
  .refine((bytes) => bytes.byteLength <= LOGO_MAX_BYTES, { message: 'The logo must be at most 2 MB.' });

export const LogoSchema = z.strictObject({
  data: logoData,
  /** PNG/JPEG only, no SVG (react-pdf cannot embed it as an image; PDF/A color space traps). */
  mime: z.enum(LOGO_MIME_TYPES),
});

export const TemplateOptionsSchema = z.strictObject({
  template: z.enum(TEMPLATE_NAMES).default('classic'),
  /** Hex color `#rrggbb`; used by the `modern` template as the bar/heading color. */
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected the accent color as a hex color #rrggbb, e.g. "#1f4e79".')
    .transform((s) => s.toLowerCase())
    .default('#1f4e79'),
  logo: LogoSchema.optional(),
  /** Switch only (reserved for a GiroCode/EPC payment QR). Currently has no effect. */
  showPaymentQr: z.boolean().default(false),
  footerText: z.string().trim().min(1).max(500).optional(),
  pageSize: z.literal('A4').default('A4'),
});

export type TemplateOptionsInput = z.input<typeof TemplateOptionsSchema>;
export type TemplateOptions = z.output<typeof TemplateOptionsSchema>;

/** Parses template options; violations as `InvoiceError` (rule `IF-TEMPLATE-001`, path `template.<field>`). */
export function parseTemplateOptions(input: unknown): TemplateOptions {
  const result = TemplateOptionsSchema.safeParse(input ?? {});
  if (result.success) return result.data;
  const violations: Violation[] = result.error.issues.map((issue) => ({
    rule: 'IF-TEMPLATE-001',
    path: formatPath(['template', ...issue.path]),
    message: issue.message,
  }));
  throw new InvoiceError(violations);
}
