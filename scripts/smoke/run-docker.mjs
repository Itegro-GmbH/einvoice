#!/usr/bin/env node
/**
 * Package smoke test on Linux: installs the packed tarball in a throw-away container (default
 * `node:24-slim`) and runs `scripts/smoke/smoke.mjs` there, first without and then with the Factur-X rule sets
 * (`einvoice-setup-facturx` downloads them, so the container needs network access). Catches path, case-sensitivity and
 * platform problems that a macOS or Windows host hides. The container has no published ports,
 * is removed afterwards (`--rm`) and only sees two read-only mounts (tarball, smoke script).
 *
 *   node scripts/smoke/run-docker.mjs [--image node:22-slim]
 *
 * Environment: SMOKE_TARBALL=<path> reuses an existing tarball, SMOKE_REACT=<version> as in run-local.mjs.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const imgIdx = args.indexOf('--image');
const image = imgIdx >= 0 ? (args[imgIdx + 1] ?? 'node:24-slim') : 'node:24-slim';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'einvoice-smoke-docker-'));

function fail(msg) {
  console.error(`smoke-docker: FAILED: ${msg}`);
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

try {
  let tarball = process.env['SMOKE_TARBALL'];
  if (tarball === undefined) {
    const r = spawnSync(npm, ['pack', '--json', '--pack-destination', work], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status !== 0) fail(`npm pack failed: ${r.stderr}`);
    tarball = path.join(work, JSON.parse(r.stdout)[0].filename);
  }
  tarball = path.resolve(tarball);
  const react = process.env['SMOKE_REACT'] ? ` react@${process.env['SMOKE_REACT']}` : '';
  const script = [
    'set -eu',
    'node --version',
    'mkdir /consumer && cd /consumer',
    'npm init -y >/dev/null && npm pkg set type=module >/dev/null',
    `npm install --no-audit --no-fund --loglevel=error /in/package.tgz${react}`,
    'cp /in/smoke.mjs .',
    'node smoke.mjs --facturx=absent',
    'npm exec -- einvoice-setup-facturx',
    'node smoke.mjs --facturx=present',
  ].join(' && ');
  const run = spawnSync(
    'docker',
    ['run', '--rm', '-v', `${tarball}:/in/package.tgz:ro`, '-v', `${path.join(root, 'scripts', 'smoke', 'smoke.mjs')}:/in/smoke.mjs:ro`, image, 'sh', '-c', script],
    { stdio: 'inherit' },
  );
  if (run.status !== 0) fail(`container run exited with ${String(run.status)}`);
  console.log(`smoke-docker: passed on ${image}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
