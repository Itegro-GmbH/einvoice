/**
 * veraPDF on every generated artifact: all golden fixtures x all four templates, plus watermark, logo
 * (PNG with alpha, JPEG, and per template logo + accent color + footer text together), the
 * 60-line invoice and the stress fixture per template. PDF/A-3B with 0 violations.
 * One single veraPDF call for all files (the JVM starts only once). Skips itself if tools/verapdf is
 * missing, unless VERAPDF_REQUIRED=1.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generate, TEMPLATE_NAMES, type GenerateOptions } from '../../src/index.js';
import { loadFixtures } from '../golden/fixtures.js';
import { longInvoice, PNG_1X1, stressInvoice } from '../helpers/fixtures.js';
import { validatePdfA3b, veraPdfAvailable, VERAPDF_SKIP_MESSAGE, type VeraPdfResult } from '../helpers/verapdf.js';

const available = veraPdfAvailable();

// CI sets VERAPDF_REQUIRED=1 (.github/workflows/ci.yml). Without this guard, a broken or removed
// setup step would make the whole suite silently `describe.skip` and PDF/A-3B compliance would go
// unchecked without CI turning red. Not set locally: a contributor who has not run
// `npm run setup:verapdf` yet still gets a green `npm test`, only skipping this suite.
if (!available && (process.env['VERAPDF_REQUIRED'] === '1' || process.env['VERAPDF_REQUIRED'] === 'true')) {
  throw new Error(`${VERAPDF_SKIP_MESSAGE} - VERAPDF_REQUIRED is set, skipping counts as a failure here.`);
}

interface Artifact {
  name: string;
  input: unknown;
  options: GenerateOptions;
}

function rgbaPng(): Buffer {
  const c = createCanvas(64, 32);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(30, 80, 200, 0.6)';
  ctx.fillRect(0, 0, 48, 32);
  ctx.fillStyle = '#ffcc00';
  ctx.fillRect(16, 8, 40, 16);
  return c.toBuffer('image/png');
}

function jpeg(): Buffer {
  const c = createCanvas(64, 32);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#cc2200';
  ctx.fillRect(0, 0, 64, 32);
  return c.toBuffer('image/jpeg');
}

function artifacts(): Artifact[] {
  const list: Artifact[] = [];
  // All golden fixtures (all four profiles, incl. XRechnung) × all four templates; this also covers the "XRechnung profile" per
  // template without needing a dedicated special case.
  for (const f of loadFixtures()) {
    for (const template of TEMPLATE_NAMES) list.push({ name: `${f.name}-${template}`, input: f.input, options: { template: { template } } });
  }
  const first = loadFixtures()[0]!;
  for (const template of TEMPLATE_NAMES) list.push({ name: `watermark-${template}`, input: first.input, options: { watermark: 'TESTMODUS', template: { template } } });
  list.push({ name: 'logo-png-alpha-classic', input: first.input, options: { template: { logo: { data: rgbaPng(), mime: 'image/png' } } } });
  list.push({ name: 'logo-png-1x1-modern', input: first.input, options: { template: { template: 'modern', logo: { data: PNG_1X1, mime: 'image/png' } } } });
  list.push({ name: 'logo-jpeg-modern', input: first.input, options: { template: { template: 'modern', logo: { data: jpeg(), mime: 'image/jpeg' }, footerText: 'Fußtext' } } });
  list.push({ name: 'long-60-classic', input: longInvoice(60), options: {} });
  list.push({ name: 'long-60-modern', input: longInvoice(60), options: { template: { template: 'modern' } } });
  // all 4 templates × (logo + accent colour + footer text) and × stress fixture (long names/addresses, long
  // IBAN/BIC, delivery address, all footer fields, page break across several pages).
  const stress = stressInvoice();
  for (const template of TEMPLATE_NAMES) {
    list.push({
      name: `logo-accent-footer-${template}`,
      input: first.input,
      options: { template: { template, logo: { data: rgbaPng(), mime: 'image/png' }, accentColor: '#a8481e', footerText: 'Vielen Dank für Ihren Auftrag.' } },
    });
    list.push({ name: `stress-${template}`, input: stress, options: { template: { template } } });
  }
  return list;
}

describe.skipIf(!available)(`veraPDF PDF/A-3B for every artifact${available ? '' : `: ${VERAPDF_SKIP_MESSAGE}`}`, () => {
  const list = artifacts();
  let dir = '';
  const results = new Map<string, VeraPdfResult>();
  let summary = '';

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'einvoice-verapdf-'));
    const files: string[] = [];
    const t0 = performance.now();
    for (const a of list) {
      const r = await generate(a.input, { ...a.options, skipXmlValidation: true });
      const file = path.join(dir, `${a.name}.pdf`);
      fs.writeFileSync(file, r.pdf);
      files.push(file);
    }
    const tGen = performance.now() - t0;
    const v = validatePdfA3b(files);
    for (const [file, res] of v.results) results.set(path.basename(file, '.pdf'), res);
    summary = `veraPDF ${v.version ?? '?'}: ${String(files.length)} PDFs generated in ${tGen.toFixed(0)} ms, checked in ${v.ms.toFixed(0)} ms (one CLI call)`;
  }, 120_000);

  afterAll(() => {
    if (dir !== '' && process.env['KEEP_PDFS'] !== '1') fs.rmSync(dir, { recursive: true, force: true });
    else if (dir !== '') process.stdout.write(`\nPDFs kept in ${dir}\n`);
    if (summary !== '') process.stdout.write(`\n${summary}\n`);
  });

  it('covers all fixtures × templates plus special cases', () => {
    expect(list.length).toBeGreaterThanOrEqual(14 * 4 + 5 + 8);
  });

  it.each(artifacts().map((a) => [a.name] as const))('%s: PDF/A-3B compliant, 0 violations', (name) => {
    const r = results.get(name);
    expect(r, `no veraPDF result for ${name}`).toBeDefined();
    expect(r!.failed.map((f) => `[${f.rule}] (${String(f.failedChecks)}x) ${f.description}\n    ${f.contexts.join('\n    ')}`)).toEqual([]);
    expect(r!.compliant).toBe(true);
    expect(r!.profile).toContain('PDF/A-3b');
  });
});

describe.skipIf(available)('veraPDF', () => {
  it.skip(VERAPDF_SKIP_MESSAGE, () => {
    /* skipped until tools/setup-verapdf.sh has been run */
  });
});
