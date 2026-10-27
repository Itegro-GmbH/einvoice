/**
 * Installs the Factur-X / ZUGFeRD Schematron rule sets (BASIC, EN 16931, EXTENDED).
 *
 * These rule sets are published by FNFE-MPE and FeRD without a license statement that permits
 * redistribution, so this package does not ship them (see NOTICE). Instead, this module downloads
 * the original stylesheets from a pinned commit of a public mirror, verifies their SHA-256, applies
 * two documented patches, and compiles them to SaxonJS SEF files that `artifacts.ts` loads.
 *
 * Patches (both verified by an exact occurrence count, so an upstream change aborts the setup
 * instead of silently producing something different):
 * - code list: the stylesheets load their code lists with `document('FACTUR-X_<PROFILE>_codedb.xml')`,
 *   which needs a base URI and file access at runtime (SaxonJS error XTDE1162). The code list is
 *   embedded as a string variable and parsed with `parse-xml()` instead, which makes the compiled
 *   file self-contained.
 * - EXTENDED: SaxonJS 2.7 compiles `round(<double>) div xs:decimal(100)` to a decimal division and
 *   fails at runtime with XPTY0004 for the tolerance rules BR-FXEXT-CO-10/11/13. `div xs:decimal(100)`
 *   is replaced by `div 100` (xs:integer is a subtype of xs:decimal, the result is identical).
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { facturxDir } from './artifacts.js';

/** Pinned upstream: commit of https://github.com/ZUGFeRD/mustangproject (Factur-X 1.09.2, ZF_250 set). */
export const FACTURX_SOURCE_COMMIT = 'abf4544f4d555b8c42e0c4edf7d6241a1d3da2c3';
const SOURCE_BASE = `https://raw.githubusercontent.com/ZUGFeRD/mustangproject/${FACTURX_SOURCE_COMMIT}/validator/src/main/resources/xslt/ZF_250`;
/** Version of the SaxonJS compiler used when `xslt3` is not already installed. */
export const XSLT3_VERSION = '2.7.0';

export interface FacturxProfileSource {
  /** Name used for the file stems: `FACTUR-X_<name>`. */
  readonly name: 'BASIC' | 'EN16931' | 'EXTENDED';
  readonly xsltSha256: string;
  readonly codedbSha256: string;
  readonly patches: readonly Patch[];
}

export interface Patch {
  readonly from: string;
  readonly to: string;
  readonly expect: number;
}

export const FACTURX_SOURCES: readonly FacturxProfileSource[] = [
  {
    name: 'BASIC',
    xsltSha256: '2e76b385c74a056ff1d31b0302c0a99ff247cbbd31dd5925c3644031d1cb9063',
    codedbSha256: 'a150b48359a72e1c1629edddb147d5133aabd03adb6ce8b3d287d0c2a6936d21',
    patches: [],
  },
  {
    name: 'EN16931',
    xsltSha256: '3a6e1d1743f8a5fd62c9797e765cac5310a84d45e424350045e8c359017c7181',
    codedbSha256: '70339a41d71b02bb97683f8eea04acbd764e077a88a446b32860d89c3351b62f',
    patches: [],
  },
  {
    name: 'EXTENDED',
    xsltSha256: 'e1d6d1dd741739bdbe8b3c7161e0f015086f1134498fdb12f180c8009790ec14',
    codedbSha256: '6e23aedbba0e3b32b3b1211d145186193215f56f755201555306c42327e75fbc',
    patches: [{ from: '/ram:LineTotalAmount) * xs:decimal(100)) div xs:decimal(100)', to: '/ram:LineTotalAmount) * xs:decimal(100)) div 100', expect: 4 }],
  },
];

export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Replaces each `from` by `to`; throws unless it occurs exactly `expect` times. */
export function applyPatches(text: string, patches: readonly Patch[], label: string): string {
  let out = text;
  for (const p of patches) {
    const n = out.split(p.from).length - 1;
    if (n !== p.expect) throw new Error(`${label}: patch pattern ${JSON.stringify(p.from)} found ${String(n)} times, expected ${String(p.expect)}. Did the upstream artifact change?`);
    out = out.split(p.from).join(p.to);
  }
  return out;
}

/** Embeds the code list as a string variable (parsed with `parse-xml()` at runtime) and replaces the `document()` calls. */
export function inlineCodedb(xsltText: string, codedbText: string, codedbFileName: string): { text: string; occurrences: number } {
  const needle = `document('${codedbFileName}')`;
  const occurrences = xsltText.split(needle).length - 1;
  if (occurrences === 0) throw new Error(`No ${needle} found in the stylesheet.`);
  const body = codedbText.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/<!--[\s\S]*?-->\s*/, '');
  const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const variable =
    `\n  <xsl:variable name="fxCodedbText" as="xs:string"><xsl:text>${escaped}</xsl:text></xsl:variable>` +
    `\n  <xsl:variable name="fxCodedb" select="parse-xml($fxCodedbText)"/>\n`;
  const openTagEnd = xsltText.indexOf('>', xsltText.indexOf('<xsl:stylesheet'));
  if (openTagEnd < 0) throw new Error('No <xsl:stylesheet> element found.');
  const withVariable = xsltText.slice(0, openTagEnd + 1) + variable + xsltText.slice(openTagEnd + 1);
  return { text: withVariable.split(needle).join('$fxCodedb'), occurrences };
}

/** Compiles an XSLT file to a SEF file. Replaceable for tests. */
export type CompileFn = (xsltPath: string, sefPath: string) => void;

/** Default compiler: the locally installed `xslt3` if there is one, otherwise `npm exec xslt3@<version>` (needs network). */
export const compileWithXslt3: CompileFn = (xsltPath, sefPath) => {
  const xsltArgs = [`-xsl:${xsltPath}`, `-export:${sefPath}`, '-nogo', '-relocate:on'];
  let local: string | undefined;
  try {
    local = createRequire(import.meta.url).resolve('xslt3/xslt3.js');
  } catch {
    local = undefined;
  }
  const win = process.platform === 'win32';
  const r =
    local !== undefined
      ? spawnSync(process.execPath, [local, ...xsltArgs], { stdio: 'inherit' })
      : spawnSync(win ? 'npm.cmd' : 'npm', ['exec', '--yes', `--package=xslt3@${XSLT3_VERSION}`, '--', 'xslt3', ...xsltArgs], { stdio: 'inherit', shell: win });
  if (r.status !== 0) throw new Error(`xslt3 failed with exit code ${String(r.status)} while compiling ${xsltPath}`);
};

export interface SetupOptions {
  /** Target directory. Default: `EINVOICE_FACTURX_DIR` or `<package>/schematron/facturx`. */
  dir?: string;
  /** Recompile even if the SEF file already exists. */
  force?: boolean;
  log?: (message: string) => void;
  /** Replaceable for tests. */
  fetchFn?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  compile?: CompileFn;
  /** Restrict to some profiles (tests). Default: all three. */
  only?: readonly FacturxProfileSource['name'][];
}

async function download(url: string, expectedSha256: string, fetchFn: NonNullable<SetupOptions['fetchFn']>): Promise<string> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${String(res.status)}): ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expectedSha256) throw new Error(`Checksum mismatch for ${url}: expected ${expectedSha256}, got ${actual}. Refusing to use the file.`);
  return Buffer.from(bytes).toString('utf8');
}

/** Downloads, verifies, patches and compiles the Factur-X rule sets. Returns the written file paths. */
export async function setupFacturx(options: SetupOptions = {}): Promise<string[]> {
  const log = options.log ?? (() => undefined);
  const fetchFn = options.fetchFn ?? ((url: string) => fetch(url));
  const compile = options.compile ?? compileWithXslt3;
  const dir = options.dir !== undefined ? path.resolve(options.dir) : facturxDir();
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const src of FACTURX_SOURCES.filter((s) => options.only === undefined || options.only.includes(s.name))) {
    const stem = `FACTUR-X_${src.name}`;
    const sefPath = path.join(dir, `${stem}.sef.json`);
    if (!options.force && fs.existsSync(sefPath)) {
      log(`${stem}: already installed (${sefPath}); use --force to rebuild`);
      written.push(sefPath);
      continue;
    }
    const t0 = performance.now();
    log(`${stem}: downloading from ${SOURCE_BASE}`);
    const xslt = await download(`${SOURCE_BASE}/${stem}.xslt`, src.xsltSha256, fetchFn);
    const codedb = await download(`${SOURCE_BASE}/${stem}_codedb.xml`, src.codedbSha256, fetchFn);
    const inlined = inlineCodedb(xslt, codedb, `${stem}_codedb.xml`);
    const patched = applyPatches(inlined.text, src.patches, stem);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'einvoice-facturx-'));
    try {
      const xsltPath = path.join(work, `${stem}.xslt`);
      const tmpSef = path.join(work, `${stem}.sef.json`);
      fs.writeFileSync(xsltPath, patched);
      log(`${stem}: compiling`);
      compile(xsltPath, tmpSef);
      fs.copyFileSync(tmpSef, sefPath);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
    log(`${stem}: installed ${sefPath} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    written.push(sefPath);
  }
  return written;
}
