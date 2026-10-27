#!/usr/bin/env node
/**
 * Release guard: the Git tag (`vX.Y.Z`) must equal the version in package.json.
 * Usage: `node scripts/check-release-version.mjs "$GITHUB_REF_NAME"`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tag = process.argv[2] ?? '';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (tag !== `v${pkg.version}`) {
  console.error(`Tag "${tag}" does not match package.json version "${pkg.version}" (expected "v${pkg.version}"). Aborting the release.`);
  process.exit(1);
}
console.log(`Tag ${tag} matches package.json version ${pkg.version}`);
