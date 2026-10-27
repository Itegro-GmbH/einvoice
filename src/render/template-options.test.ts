import { describe, expect, it } from 'vitest';
import { TemplateOptionsSchema, parseTemplateOptions, TEMPLATE_VERSION } from './template-options.js';
import { InvoiceError } from '../errors/index.js';

describe('TemplateOptionsSchema', () => {
  it('defaults: classic, A4, accent color, no logo, no QR', () => {
    const o = TemplateOptionsSchema.parse({});
    expect(o).toEqual({ template: 'classic', accentColor: '#1f4e79', showPaymentQr: false, pageSize: 'A4' });
    expect(TEMPLATE_VERSION).toMatch(/^\d+$/);
  });

  it('accent color: only a 6-digit hex color, normalized to lower case', () => {
    expect(TemplateOptionsSchema.parse({ accentColor: '#A1B2C3' }).accentColor).toBe('#a1b2c3');
    expect(() => TemplateOptionsSchema.parse({ accentColor: '#abc' })).toThrow();
    expect(() => TemplateOptionsSchema.parse({ accentColor: 'red' })).toThrow();
  });

  it('logo: PNG/JPEG as Uint8Array or base64, at most 2 MB, no SVG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(TemplateOptionsSchema.parse({ logo: { data: png, mime: 'image/png' } }).logo).toEqual({ data: png, mime: 'image/png' });
    const b64 = Buffer.from(png).toString('base64');
    expect(TemplateOptionsSchema.parse({ logo: { data: b64, mime: 'image/jpeg' } }).logo?.data).toEqual(png);
    expect(() => TemplateOptionsSchema.parse({ logo: { data: png, mime: 'image/svg+xml' } })).toThrow();
    expect(() => TemplateOptionsSchema.parse({ logo: { data: new Uint8Array(2 * 1024 * 1024 + 1), mime: 'image/png' } })).toThrow(/2 MB/);
    expect(() => TemplateOptionsSchema.parse({ logo: { data: 'not base64!!', mime: 'image/png' } })).toThrow();
  });

  it('unknown keys and invalid values are rejected', () => {
    expect(() => TemplateOptionsSchema.parse({ template: 'fancy' })).toThrow();
    expect(() => TemplateOptionsSchema.parse({ pageSize: 'Letter' })).toThrow();
    expect(() => TemplateOptionsSchema.parse({ foo: 1 })).toThrow();
    expect(TemplateOptionsSchema.parse({ footerText: 'Thanks!' }).footerText).toBe('Thanks!');
    expect(() => TemplateOptionsSchema.parse({ footerText: 'x'.repeat(501) })).toThrow();
  });

  it('parseTemplateOptions reports violations as InvoiceError with path template.*', () => {
    try {
      parseTemplateOptions({ accentColor: 'blue', logo: { data: 'AAAA', mime: 'image/gif' } });
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InvoiceError);
      const paths = (e as InvoiceError).violations.map((v) => `${v.rule} ${v.path}`);
      expect(paths).toContain('IF-TEMPLATE-001 template.accentColor');
      expect(paths).toContain('IF-TEMPLATE-001 template.logo.mime');
    }
  });
});
