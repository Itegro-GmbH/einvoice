/**
 * Example corpus (i): every official example XML must run through `validateXml` with 0 errors, which proves that
 * our validator executes the rule sets correctly. Known outliers are listed with rule IDs and a justification in
 * KNOWN_FINDINGS (exact expectation, so regressions show up there too). Warnings are printed at the end.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { validateXml, type SvrlFinding } from '../../src/index.js';
import { loadCorpus } from './corpus.js';

interface Known {
  /** Expected error rule IDs (sorted, unique). */
  rules?: string[];
  /** Expected exception (SaxonJS runtime error of the Schematron). */
  throws?: RegExp;
  reason: string;
}

const KNOWN_FINDINGS: Readonly<Record<string, Known>> = {
  'mustangproject/line-total-4-decimals.xml': {
    throws: /normalize-space\(\) is zero or one; supplied value contains 2 items/,
    reason:
      'XSD-invalid: two ram:URIID in one ram:URIUniversalCommunication (0..1). The EN16931 Schematron aborts with a dynamic XPath error (XPTY0004); an XSD check has to run before the Schematron (open point for the input validator).',
  },
  'mustangproject/testContractReferencedDocument.xml': {
    rules: ['FX-UNNAMED-1'],
    reason:
      'mustang internal test: line-level SellerOrderReferencedDocument/ContractReferencedDocument are EXTENDED elements in an EN16931 document; Factur-X EN16931 reports IssuerAssignedID as "not used" (EN16931 Schematron: warnings CII-SR-107/108/110 only).',
  },
  'mustangproject/valid_with_VAT_O.xml': {
    rules: ['BR-CO-26', 'FX-UNNAMED-1'],
    reason:
      'mustang internal test: seller without ID/GlobalID/registration/VAT ID (allowed for category O, but BR-CO-26 requires an identifier) and line-level ExemptionReason (in Factur-X EN16931 "not used").',
  },
  'xrechnung-testsuite/02.01a-cvd_INVOICE_uncefact.xml': {
    rules: ['BR-CL-13'],
    reason:
      'XRechnung CIUS "CVD" (Clean Vehicles Directive) uses the classification key "CVD", which UNTDID 7143 in the CEN Schematron 1.3.16 does not know (KoSIT only extends the list in its own rule set). CVD is not a profile of this product.',
  },
  'xrechnung-testsuite/04.05a-INVOICE_uncefact.xml': {
    rules: ['BR-CL-10', 'BR-CL-21'],
    reason:
      'XRechnung extension (BT-24 "…#conformant#urn:xeinkauf.de:kosit:extension:xrechnung_3.0"): scheme IDs XR01…XR03 (DiGA) are only allowed in the extension, not in ISO 6523 of the CEN Schematron. The extension is not a profile of this product.',
  },
};

const corpus = loadCorpus();
const collectedWarnings: { id: string; finding: SvrlFinding }[] = [];

describe('example corpus against validateXml', () => {
  it('covers at least 45 instances from three sources and all four profiles', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(45);
    expect(new Set(corpus.map((c) => c.id.split('/')[0]))).toEqual(new Set(['en16931', 'mustangproject', 'xrechnung-testsuite']));
    expect(new Set(corpus.map((c) => c.profile))).toEqual(new Set(['basic', 'en16931', 'extended', 'xrechnung']));
  });

  it('every allowlist entry exists in the corpus', () => {
    const ids = new Set(corpus.map((c) => c.id));
    for (const id of Object.keys(KNOWN_FINDINGS)) expect(ids.has(id), id).toBe(true);
  });

  it.each(corpus.map((c) => [c.id, c] as const))('%s', async (id, file) => {
    const known = KNOWN_FINDINGS[id];
    if (known?.throws !== undefined) {
      await expect(validateXml(file.xml, file.profile)).rejects.toThrow(known.throws);
      return;
    }
    const result = await validateXml(file.xml, file.profile);
    for (const w of result.warnings) collectedWarnings.push({ id, finding: w });
    const rules = [...new Set(result.errors.map((e) => e.rule))].sort();
    expect(rules, result.errors.map((e) => `${e.source} ${e.rule} @ ${e.location}: ${e.text}`).join('\n')).toEqual(known?.rules ?? []);
  });
});

afterAll(() => {
  if (collectedWarnings.length === 0) return;
  const byRule = new Map<string, Set<string>>();
  for (const { id, finding } of collectedWarnings) {
    const key = `[${finding.source}] ${finding.rule}`;
    byRule.set(key, (byRule.get(key) ?? new Set()).add(id));
  }
  const lines = [...byRule.entries()].map(([rule, ids]) => `  ${rule}: ${String(ids.size)} files`);
  process.stdout.write(`\nSchematron warnings in the example corpus (${String(collectedWarnings.length)} in ${String(new Set(collectedWarnings.map((w) => w.id)).size)} files):\n${lines.join('\n')}\n`);
});
