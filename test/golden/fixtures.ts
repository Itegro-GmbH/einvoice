/**
 * Golden fixtures: JSON input (`fixtures/<name>.json`) and expected XML (`fixtures/<name>.xml`).
 * Update with `UPDATE_GOLDEN=1 npx vitest run test/golden`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InvoiceInput, Profile } from '../../src/index.js';

export const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export interface GoldenFixture {
  name: string;
  input: InvoiceInput;
  profile: Profile;
  xmlPath: string;
}

export function loadFixtures(): GoldenFixture[] {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const name = f.replace(/\.json$/, '');
      const input = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')) as InvoiceInput;
      return { name, input, profile: input.profile ?? 'en16931', xmlPath: path.join(FIXTURE_DIR, `${name}.xml`) };
    });
}

export const UPDATE_GOLDEN = process.env['UPDATE_GOLDEN'] === '1';
