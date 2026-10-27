/**
 * Example corpus (ii): for selected official examples an equivalent input JSON exists (`inputs/`).
 * XML is generated from it and the **business-relevant values** (totals, tax breakdown, categories, lines,
 * profile URN, …) are compared against the original via XPath: no byte comparison, a different element order/whitespace
 * is explicitly fine. In addition, the generated XML must pass the Schematron output validation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateXml, type InvoiceInput } from '../../src/index.js';
import { CORPUS_DIR, extractBusinessValues, parseXml, profileOfXml } from './corpus.js';

const INPUT_DIR = path.join(CORPUS_DIR, 'inputs');
const cases = fs
  .readdirSync(INPUT_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => {
    const originalId = f.replace(/\.json$/, '').replace('__', '/') + '.xml';
    return { name: f.replace(/\.json$/, ''), originalPath: path.join(CORPUS_DIR, originalId), inputPath: path.join(INPUT_DIR, f) };
  });

describe('example corpus: equivalent inputs produce business-equivalent XML', () => {
  it('at least 6 examples from different profiles', () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const originalXml = fs.readFileSync(c.originalPath, 'utf8');
    const input = JSON.parse(fs.readFileSync(c.inputPath, 'utf8')) as InvoiceInput;
    const { xml, profile } = await generateXml(input);
    expect(profile).toBe(profileOfXml(originalXml));

    const expected = extractBusinessValues(await parseXml(originalXml));
    const actual = extractBusinessValues(await parseXml(xml));
    // The originals write BT-119 for category O/AE sometimes as 0.00, sometimes not at all, so the rate is compared only if both have it.
    const normalizeRates = (v: typeof expected): typeof expected => ({
      ...v,
      lines: v.lines.map((l) => ({ ...l, rate: l.rate ?? 0 })),
      vatBreakdown: v.vatBreakdown.map((b) => ({ ...b, rate: b.rate ?? 0 })),
    });
    expect(normalizeRates(actual)).toEqual(normalizeRates(expected));
  });
});
