/**
 * Golden file tests: JSON in, XML out, byte-compared against the checked-in reference.
 * Every unintended change to the serialization shows up here immediately.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateXml } from '../../src/index.js';
import { loadFixtures, UPDATE_GOLDEN } from './fixtures.js';

const fixtures = loadFixtures();

describe('golden files (byte comparison)', () => {
  it('there are at least 12 fixtures and all four profiles', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
    expect(new Set(fixtures.map((f) => f.profile))).toEqual(new Set(['basic', 'en16931', 'extended', 'xrechnung']));
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, f) => {
    const { xml, profile } = await generateXml(f.input, { skipXmlValidation: true });
    expect(profile).toBe(f.profile);
    if (UPDATE_GOLDEN || !fs.existsSync(f.xmlPath)) fs.writeFileSync(f.xmlPath, xml);
    expect(xml).toBe(fs.readFileSync(f.xmlPath, 'utf8'));
  });

  it('serialization is deterministic (second run byte-identical)', async () => {
    const f = fixtures[0]!;
    const a = await generateXml(f.input, { skipXmlValidation: true });
    const b = await generateXml(f.input, { skipXmlValidation: true });
    expect(b.xml).toBe(a.xml);
  });
});
