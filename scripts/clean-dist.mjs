#!/usr/bin/env node
// Removes `dist/` before a build so that no file from an earlier build (renamed or deleted
// sources, test files) can end up in the published package. Cross-platform replacement for `rm -rf`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
