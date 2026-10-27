/**
 * Guard: templates contain no visible text; everything comes from `render/i18n/<locale>.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './index.js';
import { TEMPLATE_NAMES } from '../template-options.js';
import { de } from '../i18n/de.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = ['classic.ts', 'modern.ts', 'minimal.ts', 'elegant.ts', 'shared.ts'];

describe('Templates', () => {
  it('registers exactly the names from TemplateOptionsSchema', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual([...TEMPLATE_NAMES].sort());
  });

  it.each(SOURCES)('%s contains no hard-coded texts (umlauts, words from i18n/de.ts)', (file) => {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/[äöüÄÖÜß]/);
    const words = Object.values(de).flatMap((v) => (typeof v === 'string' && /^[A-Za-z]{4,}$/.test(v) ? [v] : []));
    for (const w of words) expect(src, `"${w}" in ${file}`).not.toMatch(new RegExp(`['"\`]${w}['"\`]`));
  });
});
