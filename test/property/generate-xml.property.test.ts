/**
 * Property test light: random, business-valid invoices (category S only) → `generateXml` must
 * not throw, and the Schematron output validation (EN 16931 + Factur-X EN16931) finds 0 errors.
 * Runtime: ~50 runs × 2 rule sets at ~50–150 ms each, deliberately below the 60 s limit.
 * Additionally 10 invoices through `generate()` (rendering + PDF/A-3, without Schematron/veraPDF).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { generateXml, generate, extractXml, validate, calculate, normalize } from '../../src/index.js';
import { validInvoiceInputArb } from '../arbitraries.js';

const NUM_RUNS = 50;

describe('generateXml – Eigenschaften (fast-check)', () => {
  it('random invoices (S only) pass validate() without a violation', () => {
    fc.assert(
      fc.property(validInvoiceInputArb, (input) => {
        const r = validate(calculate(normalize(input)));
        expect(r.violations).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('generateXml does not throw and Schematron finds 0 errors', async () => {
    await fc.assert(
      fc.asyncProperty(validInvoiceInputArb, async (input) => {
        const { xml, warnings } = await generateXml(input);
        expect(xml).toContain('<rsm:CrossIndustryInvoice');
        // Our own invoices must never produce a passed-through Schematron warning (not even SCH-PEPPOL-EN16931-R008
        // any more: it is suppressed by IF-WARN-002 or periodStart/periodEnd).
        expect(warnings.filter((w) => w.code.startsWith('SCH-'))).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  }, 120_000);

  it('generate() (without Schematron/veraPDF) does not throw, pages ≥ 1, extractXml roundtrip byte-identical', async () => {
    await fc.assert(
      fc.asyncProperty(validInvoiceInputArb, fc.constantFrom('classic', 'modern'), async (input, template) => {
        const r = await generate(input, { skipXmlValidation: true, template: { template } });
        expect(r.meta.pages).toBeGreaterThanOrEqual(1);
        expect(r.pdf.byteLength).toBeGreaterThan(10_000);
        expect((await extractXml(r.pdf))?.xml).toBe(r.xml);
      }),
      { numRuns: 10 },
    );
  }, 120_000);
});
