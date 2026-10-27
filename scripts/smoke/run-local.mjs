#!/usr/bin/env node
/**
 * Package smoke test on the host. Proves that what consumers actually install works, in three
 * ways that mirror the documented installation paths (README, "Installation"):
 *
 *   tarball  `npm install <file>.tgz`            (what the npm registry serves, built by `npm pack`)
 *   url      `npm install http://127.0.0.1:<port>/<file>.tgz`
 *                                               (stand-in for the GitHub release asset URL)
 *   git      `npm install git+file://<clone>#semver:^<version>`
 *                                               (stand-in for `github:Itegro-GmbH/einvoice#semver:...`;
 *                                                builds the package during installation via `prepare`)
 *
 * Every mode installs into a fresh, empty directory outside the repository and runs
 * `scripts/smoke/smoke.mjs` there. The tarball mode additionally compiles a TypeScript consumer
 * against the installed .d.ts files and runs `einvoice-setup-facturx` followed by a second smoke
 * run with all Factur-X rule sets present (needs network). Usage:
 *
 *   node scripts/smoke/run-local.mjs [--mode tarball|url|git|all] [--keep] [--no-facturx]
 *
 * Environment: SMOKE_REACT=<version> installs that React version in the consumer (default: the
 * newest React satisfying the peer range), SMOKE_TARBALL=<path> reuses an existing tarball.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const modeIdx = args.indexOf('--mode');
const mode = modeIdx >= 0 ? (args[modeIdx + 1] ?? 'all') : 'all';
const keep = args.includes('--keep');
const withFacturx = !args.includes('--no-facturx');
const modes = mode === 'all' ? ['tarball', 'url', 'git'] : [mode];
for (const m of modes) if (!['tarball', 'url', 'git'].includes(m)) fail(`unknown mode ${m}`);

const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'einvoice-smoke-'));

function fail(msg) {
  console.error(`smoke: FAILED: ${msg}`);
  process.exit(1);
}

/** Runs a command asynchronously (the event loop must stay free for the local HTTP server). */
function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: win, ...opts });
    child.on('exit', (code) => {
      if (code !== 0) fail(`${cmd} ${cmdArgs.join(' ')} exited with ${String(code)}`);
      resolve();
    });
    child.on('error', (e) => fail(`${cmd}: ${e.message}`));
  });
}

function capture(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', shell: win, ...opts });
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} exited with ${String(r.status)}: ${r.stderr}`);
  return r.stdout;
}

/** Packs the package (the build runs as part of `npm pack`) and returns the tarball path. */
function pack() {
  if (process.env['SMOKE_TARBALL']) return path.resolve(process.env['SMOKE_TARBALL']);
  const dest = path.join(work, 'pack');
  fs.mkdirSync(dest);
  const info = JSON.parse(capture(npm, ['pack', '--json', '--pack-destination', dest], { cwd: root }));
  console.log(`smoke: packed ${info[0].filename} (${info[0].size} bytes packed, ${info[0].unpackedSize} bytes unpacked, ${info[0].entryCount} files)`);
  return path.join(dest, info[0].filename);
}

/** Creates an empty consumer project and installs `spec` (plus an optional React override). */
async function install(name, spec) {
  const dir = path.join(work, `consumer-${name}`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `consumer-${name}`, version: '0.0.0', private: true, type: 'module' }, null, 2));
  const react = process.env['SMOKE_REACT'];
  await run(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error', spec, ...(react ? [`react@${react}`] : [])], { cwd: dir });
  fs.copyFileSync(path.join(root, 'scripts', 'smoke', 'smoke.mjs'), path.join(dir, 'smoke.mjs'));
  return dir;
}

async function runSmoke(dir, label, facturx) {
  console.log(`\nsmoke[${label}]: running in ${dir} (facturx=${facturx})`);
  await run(process.execPath, ['smoke.mjs', `--facturx=${facturx}`], { cwd: dir });
}

function checkInstalledLayout(dir) {
  const base = path.join(dir, 'node_modules', '@itegro', 'einvoice');
  for (const f of ['dist/index.js', 'dist/index.d.ts', 'dist/cli/setup-facturx.js', 'assets/icc/sRGB-v2-magic.icc', 'assets/fonts/DejaVuSans.ttf', 'schematron/xrechnung/XRechnung-CII-validation.sef.json', 'schematron/en16931/EN16931-CII-validation.sef.json', 'LICENSE', 'NOTICE', 'licenses/EUPL-1.2.txt']) {
    if (!fs.existsSync(path.join(base, f))) fail(`installed package lacks ${f}`);
  }
  for (const f of ['src', 'test', 'dist/index.test.js', 'schematron/facturx', 'schematron/en16931/EN16931-CII-validation.xslt']) {
    if (fs.existsSync(path.join(base, f))) fail(`installed package unexpectedly contains ${f}`);
  }
}

async function typeCheck(dir) {
  console.log('\nsmoke[types]: compiling a TypeScript consumer against the installed .d.ts files');
  await run(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error', '--no-save', 'typescript@5.9.3', '@types/node@22', '@types/react@19'], { cwd: dir });
  fs.copyFileSync(path.join(root, 'scripts', 'smoke', 'types-check.ts'), path.join(dir, 'types-check.ts'));
  const tsc = path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc');
  await run(process.execPath, [tsc, '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', '--types', 'node', 'types-check.ts'], { cwd: dir });
}

/** Installs the Factur-X rule sets with the package's own CLI, then re-runs the smoke test. */
async function facturxPhase(dir, label) {
  console.log(`\nsmoke[${label}]: running einvoice-setup-facturx (downloads and compiles, needs network)`);
  await run(npm, ['exec', '--', 'einvoice-setup-facturx'], { cwd: dir });
  await runSmoke(dir, `${label}+facturx`, 'present');
}

/** Serves the tarball over HTTP on an ephemeral loopback port, like a release asset URL. */
function serve(file) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url !== `/${path.basename(file)}`) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': fs.statSync(file).size });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Local stand-in for the public GitHub repository: a clone of the committed HEAD with the release tag. */
async function makeGitSource() {
  const dirty = capture('git', ['status', '--porcelain'], { cwd: root }).trim();
  if (dirty !== '') console.warn('smoke: WARNING: working tree has uncommitted changes; the git mode tests the committed HEAD only');
  const clone = path.join(work, 'git-source');
  await run('git', ['clone', '--quiet', '--local', root, clone]);
  // `-f`: once the real release tag exists upstream, the clone already carries it, and a plain
  // `git tag -a` would fail. The clone is throwaway, so moving the tag onto its HEAD is safe.
  await run('git', ['-c', 'user.name=smoke', '-c', 'user.email=smoke@example.invalid', 'tag', '-f', '-a', `v${pkg.version}`, '-m', 'smoke'], { cwd: clone });
  return clone;
}

let server;
try {
  const tarball = modes.includes('tarball') || modes.includes('url') ? pack() : undefined;

  if (modes.includes('tarball')) {
    const dir = await install('tarball', tarball);
    checkInstalledLayout(dir);
    await runSmoke(dir, 'tarball', 'absent');
    await typeCheck(dir);
    if (withFacturx) await facturxPhase(dir, 'tarball');
  }
  if (modes.includes('url')) {
    server = await serve(tarball);
    const url = `http://127.0.0.1:${server.address().port}/${path.basename(tarball)}`;
    const dir = await install('url', url);
    checkInstalledLayout(dir);
    await runSmoke(dir, 'url', 'absent');
  }
  if (modes.includes('git')) {
    const clone = await makeGitSource();
    const dir = await install('git', `git+file://${clone.split(path.sep).join('/')}#semver:^${pkg.version}`);
    checkInstalledLayout(dir);
    await runSmoke(dir, 'git', 'absent');
  }
  console.log(`\nsmoke: all modes passed (${modes.join(', ')})`);
} finally {
  server?.close();
  if (!keep) fs.rmSync(work, { recursive: true, force: true });
  else console.log(`smoke: kept ${work}`);
}
