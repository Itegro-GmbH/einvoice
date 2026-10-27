#!/usr/bin/env node
/**
 * Prints the CHANGELOG.md section of a version (Keep a Changelog format) for the GitHub release
 * notes: `node scripts/release-notes.mjs 0.1.0`. Fails if the section is missing or empty, so a
 * release without a changelog entry cannot happen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (version === undefined || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('usage: node scripts/release-notes.mjs <version>');
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split('\n');
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start < 0) {
  console.error(`CHANGELOG.md has no section "## [${version}]"`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && (l.startsWith('## [') || l.startsWith('[') ));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).join('\n').trim();
if (body === '') {
  console.error(`The CHANGELOG.md section for ${version} is empty`);
  process.exit(1);
}
process.stdout.write(`${body}\n`);
