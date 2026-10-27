/**
 * Loads the precompiled Schematron rule sets (SaxonJS SEF files).
 *
 * The only place that knows about the filesystem and paths; if a bundler or a serverless
 * platform provides the artifacts differently (file tracing, `includeFiles`, inlining), only this
 * module changes. The SEFs are parsed once per process and kept in module scope (SaxonJS itself
 * does not cache them).
 *
 * Where the files live:
 * - EN16931 and XRECHNUNG ship inside the package (`schematron/`).
 * - The three Factur-X rule sets (FACTURX-BASIC, FACTURX-EN16931, FACTURX-EXTENDED) are NOT part
 *   of the package for licensing reasons (see NOTICE). `npx einvoice-setup-facturx` downloads the
 *   official sources and compiles them into `schematron/facturx/` inside the installed package,
 *   or into the directory named by the environment variable `EINVOICE_FACTURX_DIR`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { packagePath } from '../package-paths.js';

export const RULE_SETS = ['EN16931', 'FACTURX-BASIC', 'FACTURX-EN16931', 'FACTURX-EXTENDED', 'XRECHNUNG'] as const;
export type RuleSet = (typeof RULE_SETS)[number];

/** Rule sets that are downloaded and compiled on demand instead of being shipped. */
export const FACTURX_RULE_SETS = ['FACTURX-BASIC', 'FACTURX-EN16931', 'FACTURX-EXTENDED'] as const satisfies readonly RuleSet[];

const SEF_FILES: Readonly<Record<RuleSet, string>> = {
  EN16931: 'en16931/EN16931-CII-validation.sef.json',
  'FACTURX-BASIC': 'FACTUR-X_BASIC.sef.json',
  'FACTURX-EN16931': 'FACTUR-X_EN16931.sef.json',
  'FACTURX-EXTENDED': 'FACTUR-X_EXTENDED.sef.json',
  XRECHNUNG: 'xrechnung/XRechnung-CII-validation.sef.json',
};

/** Thrown when the compiled file of a rule set is not installed. */
export class RuleSetUnavailableError extends Error {
  override readonly name = 'RuleSetUnavailableError';
  constructor(
    readonly ruleSet: RuleSet,
    readonly path: string,
  ) {
    super(`Schematron rule set ${ruleSet} is not installed (expected ${path}). Run "npx einvoice-setup-facturx" to install the Factur-X rule sets.`);
  }
}

/** Directory the Factur-X rule sets are read from (`EINVOICE_FACTURX_DIR`, else `<package>/schematron/facturx`). */
export function facturxDir(): string {
  const fromEnv = process.env['EINVOICE_FACTURX_DIR'];
  return fromEnv !== undefined && fromEnv !== '' ? path.resolve(fromEnv) : packagePath('schematron', 'facturx');
}

/** Absolute path of the SEF file of a rule set. */
export function artifactPath(ruleSet: RuleSet): string {
  const file = SEF_FILES[ruleSet];
  return (FACTURX_RULE_SETS as readonly string[]).includes(ruleSet) ? path.join(facturxDir(), file) : packagePath('schematron', file);
}

/** `true` if the compiled file of the rule set exists on disk. */
export function isRuleSetAvailable(ruleSet: RuleSet): boolean {
  return fs.existsSync(artifactPath(ruleSet));
}

const cache = new Map<string, object>();

/** Parsed SEF (JSON object), loaded once per process. Throws `RuleSetUnavailableError` if the file is missing. */
export function loadSef(ruleSet: RuleSet): object {
  const file = artifactPath(ruleSet);
  let sef = cache.get(file);
  if (sef === undefined) {
    if (!fs.existsSync(file)) throw new RuleSetUnavailableError(ruleSet, file);
    sef = JSON.parse(fs.readFileSync(file, 'utf8')) as object;
    cache.set(file, sef);
  }
  return sef;
}

/** Preloads all installed rule sets (e.g. on a function's warm start). Missing Factur-X rule sets are skipped. */
export function preloadAll(): void {
  for (const rs of RULE_SETS) if (isRuleSetAvailable(rs)) loadSef(rs);
}
