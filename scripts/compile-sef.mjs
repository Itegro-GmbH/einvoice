#!/usr/bin/env node
/**
 * Compiles the Schematron XSLTs under `schematron/` with `xslt3` (SaxonJS) to SEF JSON.
 *
 * Usage: `npm run compile-sef`. The SEF files are committed; this step is only needed after a
 * Schematron update. It covers the rule sets that ship with the package (EN 16931, XRechnung).
 * The Factur-X rule sets are built on the user's machine by `einvoice-setup-facturx`
 * (src/xml-validate/facturx-setup.ts), not here.
 *
 * SaxonJS workaround (XRechnung): see IBAN_MOD97_EXACT below.
 *
 * Reproducibility: SaxonJS writes `buildDateTime` into the SEF and protects the file with a
 * checksum, so patching it afterwards is impossible (SXJS0006). Two runs differ only in that
 * timestamp (and the checksum); the content is functionally identical.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schematron = path.join(root, 'schematron');
const xslt3 = path.join(root, 'node_modules', '.bin', 'xslt3');

/**
 * SaxonJS workaround (XRechnung): `xr:checkIBAN` maps the IBAN to a number of up to 34 digits and
 * computes `xs:integer(...) mod 97`. SaxonJS 2.7 holds xs:integer as a double (53 bits), so the
 * number loses digits, the result is wrong, and every valid IBAN would trigger BR-DE-19/BR-DE-20
 * (warning). Replaced by an exact digit-by-digit mod-97 computation (fold-left), mathematically identical.
 */
const IBAN_MOD97_ORIGINAL = "xs:integer(string-join(for $cp in string-to-codepoints(concat(substring($normalizedIban,5),upper-case(substring($normalizedIban,1,2)),substring($normalizedIban,3,2))) return (if($cp &gt; 64) then string($cp - 55) else string($cp - 48)),'')) mod 97 = 1";
const IBAN_MOD97_EXACT = "fold-left(string-to-codepoints(string-join(for $cp in string-to-codepoints(concat(substring($normalizedIban,5),upper-case(substring($normalizedIban,1,2)),substring($normalizedIban,3,2))) return (if($cp &gt; 64) then string($cp - 55) else string($cp - 48)),'')), 0, function($acc, $d) { ($acc * 10 + ($d - 48)) mod 97 }) = 1";

/** @type {{ xslt: string; sef: string; patches?: { from: string; to: string; expect: number }[] }[]} */
const JOBS = [
  { xslt: 'en16931/EN16931-CII-validation.xslt', sef: 'en16931/EN16931-CII-validation.sef.json' },
  {
    xslt: 'xrechnung/XRechnung-CII-validation.xsl',
    sef: 'xrechnung/XRechnung-CII-validation.sef.json',
    patches: [{ from: IBAN_MOD97_ORIGINAL, to: IBAN_MOD97_EXACT, expect: 1 }],
  },
];

function applyPatches(text, patches, label) {
  for (const p of patches) {
    const n = text.split(p.from).length - 1;
    if (n !== p.expect) throw new Error(`${label}: patch pattern ${JSON.stringify(p.from)} found ${n} times, expected ${p.expect}. Did the artifact change? Check the workaround.`);
    text = text.split(p.from).join(p.to);
  }
  return text;
}

function compile(job) {
  const t0 = performance.now();
  // Always compile from a copy in a neutral temp directory: SaxonJS embeds the stylesheet's absolute
  // path in the SEF, and the path of a developer's checkout should not end up in a published file.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'einvoice-sef-'));
  let text = fs.readFileSync(path.join(schematron, job.xslt), 'utf8');
  let note = '';
  if (job.patches) {
    text = applyPatches(text, job.patches, job.xslt);
    note += ` (${job.patches.length} SaxonJS workaround patch)`;
  }
  const xsltPath = path.join(tmpDir, path.basename(job.xslt));
  fs.writeFileSync(xsltPath, text);
  const sefPath = path.join(schematron, job.sef);
  const r = spawnSync(xslt3, [`-xsl:${xsltPath}`, `-export:${sefPath}`, '-nogo', '-relocate:on'], { stdio: 'inherit' });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (r.status !== 0) {
    console.error(`ERROR compiling ${job.xslt}`);
    process.exit(r.status ?? 1);
  }
  const kb = (fs.statSync(sefPath).size / 1024).toFixed(0);
  console.log(`${job.sef}: ${kb} KB in ${((performance.now() - t0) / 1000).toFixed(1)} s${note}`);
}

for (const job of JOBS) compile(job);
