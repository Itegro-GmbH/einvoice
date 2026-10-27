/**
 * Visual snapshot tests: page 1 of the generated PDF is rasterized and compared pixel by pixel with the
 * checked-in reference (pixelmatch). To update: `UPDATE_SNAPSHOTS=1 npx vitest run test/visual`.
 * Rasterizer: pdfjs-dist + @napi-rs/canvas (see test/helpers/rasterize.ts); without a rasterizer the test skips itself.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { generate, type GenerateOptions } from '../../src/index.js';
import { loadFixture, stressInvoice } from '../helpers/fixtures.js';
import { getRasterizer } from '../helpers/rasterize.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(DIR, '__snapshots__');
const UPDATE = process.env['UPDATE_SNAPSHOTS'] === '1';
const SCALE = 1; // 595×842 px for A4
/** Share of differing pixels that is tolerated (anti-aliasing differences between platforms). */
const MAX_DIFF_RATIO = 0.001;
const LOGO = fs.readFileSync(path.join(DIR, 'fixtures', 'logo.png'));
const STRESS = stressInvoice();

interface Case {
  name: string;
  input: unknown;
  options: GenerateOptions;
  /** Page that is rasterized; `'last'` resolves via `meta.pages` (stress fixture, page break). */
  page?: number | 'last';
}

const cases: Case[] = [
  { name: 'fixture01-classic', input: loadFixture('01-simple-19-en16931'), options: {} },
  { name: 'fixture01-modern', input: loadFixture('01-simple-19-en16931'), options: { template: { template: 'modern' } } },
  { name: 'fixture01-minimal', input: loadFixture('01-simple-19-en16931'), options: { template: { template: 'minimal' } } },
  { name: 'fixture01-elegant', input: loadFixture('01-simple-19-en16931'), options: { template: { template: 'elegant' } } },
  { name: 'fixture02-classic', input: loadFixture('02-mixed-7-19-allowance-en16931'), options: {} },
  { name: 'watermark-classic', input: loadFixture('01-simple-19-en16931'), options: { watermark: 'TESTMODUS' } },
  { name: 'logo-modern', input: loadFixture('01-simple-19-en16931'), options: { template: { template: 'modern', logo: { data: LOGO, mime: 'image/png' }, footerText: 'Vielen Dank für Ihr Vertrauen.' } } },
  // stress fixture per template, first and last page (table header repetition, "Seite n von m",
  // totals block not split, many line items with long names/descriptions).
  ...(['classic', 'modern', 'minimal', 'elegant'] as const).flatMap((template) => [
    { name: `stress-${template}-first`, input: STRESS, options: { template: { template } }, page: 1 },
    { name: `stress-${template}-last`, input: STRESS, options: { template: { template } }, page: 'last' as const },
  ]),
];

const rasterizer = await getRasterizer();

describe.skipIf(rasterizer === undefined)(`Visual snapshots (${rasterizer?.name ?? 'no rasterizer available, skipped'})`, () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', async (name, c) => {
    const { pdf, meta } = await generate(c.input, { ...c.options, skipXmlValidation: true });
    const page = c.page === undefined ? 1 : c.page === 'last' ? meta.pages : c.page;
    const actualPng = await rasterizer!.render(pdf, page, SCALE);
    const file = path.join(SNAPSHOT_DIR, `${name}.png`);
    if (UPDATE || !fs.existsSync(file)) {
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
      fs.writeFileSync(file, actualPng);
    }
    const expected = PNG.sync.read(fs.readFileSync(file));
    const actual = PNG.sync.read(actualPng);
    expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
    const diff = new PNG({ width: expected.width, height: expected.height });
    const differing = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: 0.1 });
    const ratio = differing / (expected.width * expected.height);
    if (ratio > MAX_DIFF_RATIO) {
      const out = path.join(os.tmpdir(), `einvoice-snapshot-${name}`);
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'actual.png'), actualPng);
      fs.writeFileSync(path.join(out, 'diff.png'), PNG.sync.write(diff));
      expect.fail(`${name}: ${String(differing)} differing pixels (${(ratio * 100).toFixed(3)} %); actual/diff under ${out}; update the reference with UPDATE_SNAPSHOTS=1`);
    }
  }, 30_000);

  it('rasterizer is deterministic (two runs → identical PNG bytes)', async () => {
    const { pdf } = await generate(loadFixture('01-simple-19-en16931'), { skipXmlValidation: true });
    const a = await rasterizer!.render(pdf, 1, SCALE);
    const b = await rasterizer!.render(pdf, 1, SCALE);
    expect(Buffer.compare(a, b)).toBe(0);
  });
});
