/**
 * Schematron in CI for every generated artifact: every golden fixture is generated and checked against
 * EN 16931 **and** the profile rule set (Factur-X BASIC/EN16931/EXTENDED or XRechnung): 0 errors.
 * Warnings are collected and printed at the end (they appear in the report docs/reports/phase1c.md).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { generateXml, validateXml, type SvrlFinding } from '../../src/index.js';
import { loadFixtures } from './fixtures.js';

const fixtures = loadFixtures();
const collectedWarnings: { fixture: string; finding: SvrlFinding }[] = [];

describe('golden fixtures against Schematron (EN 16931 + profile)', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s: 0 Schematron errors', async (name, f) => {
    const { xml } = await generateXml(f.input, { skipXmlValidation: true });
    const result = await validateXml(xml, f.profile);
    for (const w of result.warnings) collectedWarnings.push({ fixture: name, finding: w });
    expect(result.errors.map((e) => `${e.source} ${e.rule} @ ${e.location}: ${e.text}`)).toEqual([]);
  });

  it('generateXml passes Schematron warnings through as SCH-* (fixture 1: none)', async () => {
    const f = fixtures.find((x) => x.name.startsWith('01-'))!;
    const { warnings } = await generateXml(f.input);
    expect(warnings.filter((w) => w.code.startsWith('SCH-'))).toEqual([]);
  });
});

afterAll(() => {
  if (collectedWarnings.length === 0) return;
  const lines = collectedWarnings.map(({ fixture, finding }) => `  ${fixture}: [${finding.source}] ${finding.rule} (${finding.flag}) ${finding.text}`);
  process.stdout.write(`\nSchematron warnings of the golden fixtures (${String(collectedWarnings.length)}):\n${lines.join('\n')}\n`);
});
