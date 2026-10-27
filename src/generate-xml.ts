/**
 * `generateXml()`, the pipeline through to validated CII XML:
 *
 *   parse -> normalize -> calculate -> validate (throws InvoiceError on violations)
 *         -> serializeCii -> validateXml (Schematron: EN 16931 + profile rule set)
 *
 * The Schematron output validation must never produce errors when the serializer is correct; if
 * it does, that is an internal error and is thrown as `InvoiceError` with the Schematron ID,
 * XPath, and a "please report this" hint. Schematron warnings are passed through as `Warning`
 * with `code: 'SCH-<rule ID>'`: `path` here, like for every warning, is an input path, never an
 * XPath (the nearest mappable parent path, if the Schematron node has no exact match in the
 * input; `''`, the invoice as a whole, if no mapping can be found at all); the original XPath
 * location is always additionally available in `xpath`. For known rules (see
 * `schematron-texts.ts`), an English text replaces the raw Schematron message; if an `IF-*`
 * warning of our own already reports the same fact in the same result, the SCH warning is
 * dropped.
 */
import { calculate } from './calculate/index.js';
import { InvoiceError, type Violation } from './errors/index.js';
import type { CalculatedInvoice } from './model/calculated.js';
import type { Profile } from './model/input.js';
import { normalize } from './normalize/index.js';
import { serializeCii } from './serialize/cii/index.js';
import { assertValid, type Warning } from './validate/index.js';
import { validateXml, type RuleSet, type SvrlFinding } from './xml-validate/index.js';
import { mapSchematronLocation } from './xml-validate/schematron-path.js';
import { SCHEMATRON_SUPPRESSED_BY, SCHEMATRON_TEXTS } from './xml-validate/schematron-texts.js';

export interface GenerateXmlOptions {
  /** Skip Schematron output validation (tests, performance measurement). Default: false. */
  skipXmlValidation?: boolean;
  /**
   * Fail with `RuleSetUnavailableError` if a Factur-X rule set required by the profile is not
   * installed. Default: false (the rule set is skipped and warning `IF-WARN-100` is added).
   */
  requireAllRuleSets?: boolean;
}

export interface GenerateXmlResult {
  xml: string;
  warnings: Warning[];
  profile: Profile;
}

export interface XmlStageTimings {
  /** parse + normalize + calculate + validate */
  validate: number;
  serialize: number;
  /** 0 if skipped */
  schematron: number;
}

/** Like `generateXml`, plus the calculated model and stage timings (for `generate()`). */
export interface GenerateXmlDetailedResult extends GenerateXmlResult {
  calculated: CalculatedInvoice;
  durationMs: XmlStageTimings;
}

export const SCHEMATRON_HINT = 'Internal serialization error, please report this';

const BUSINESS_TERM = /\b(B[TG]-\d+)\b/;

/** Extracts the business term from the Schematron text (e.g. "... (BT-112) ..."), if present. */
export function extractBusinessTerm(text: string): string | undefined {
  return BUSINESS_TERM.exec(text)?.[1];
}

export function schematronViolation(f: SvrlFinding): Violation {
  const v: Violation = { rule: f.rule, path: f.location, message: f.text, hint: SCHEMATRON_HINT };
  const bt = extractBusinessTerm(f.text);
  if (bt !== undefined) v.businessTerm = bt;
  return v;
}

/**
 * `true` if the SCH warning `w` is dropped: a warning of our own already reports the same fact
 * in input terms (`by`) in the same result, or an additional condition (`alsoIf`) is met; both
 * only when `w.path` matches the `requiredPath` recorded in `SCHEMATRON_SUPPRESSED_BY`. This
 * location binding prevents a generic rule such as R008 ("Document MUST not contain empty
 * elements") from being suppressed elsewhere just because `by` happens to occur in the same
 * result.
 */
export function isSuppressedByOwnWarning(w: Warning, ownWarnings: readonly Warning[], invoice: CalculatedInvoice): boolean {
  const rule = w.code.replace(/^SCH-/, '');
  const suppression = SCHEMATRON_SUPPRESSED_BY[rule];
  if (suppression === undefined || w.path !== suppression.requiredPath) return false;
  if (ownWarnings.some((o) => o.code === suppression.by)) return true;
  return suppression.alsoIf?.(invoice) === true;
}

export function schematronWarning(f: SvrlFinding, invoice: CalculatedInvoice): Warning {
  const known = SCHEMATRON_TEXTS[f.rule];
  const w: Warning = {
    code: `SCH-${f.rule}`,
    // No mappable input path: '' (the invoice as a whole) instead of the raw XPath, which now only
    // lives in `xpath`.
    path: mapSchematronLocation(f.location, invoice) ?? '',
    message: known?.message ?? f.text,
    xpath: f.location,
  };
  const bt = extractBusinessTerm(f.text);
  if (bt !== undefined) w.businessTerm = bt;
  if (known?.hint !== undefined) w.hint = known.hint;
  return w;
}

/** Warning `IF-WARN-100`: a Factur-X rule set is not installed, so the XML was checked against fewer rules. */
export function ruleSetSkippedWarning(ruleSet: RuleSet): Warning {
  return {
    code: 'IF-WARN-100',
    path: '',
    message: `The Schematron rule set ${ruleSet} is not installed; the XML was not checked against it.`,
    hint: 'Run "npx einvoice-setup-facturx" once to download and compile the Factur-X rule sets, or pass requireAllRuleSets: true to fail instead.',
  };
}

export async function generateXmlDetailed(input: unknown, options: GenerateXmlOptions = {}): Promise<GenerateXmlDetailedResult> {
  const t0 = performance.now();
  const calculated = calculate(normalize(input));
  const warnings = assertValid(calculated);
  const t1 = performance.now();
  const xml = serializeCii(calculated);
  const t2 = performance.now();
  let schematron = 0;
  if (options.skipXmlValidation !== true) {
    const result = await validateXml(xml, calculated.profile, options.requireAllRuleSets === true ? { requireAllRuleSets: true } : {});
    schematron = performance.now() - t2;
    if (result.errors.length > 0) throw new InvoiceError(result.errors.map(schematronViolation));
    const schWarnings = result.warnings.map((f) => schematronWarning(f, calculated)).filter((w) => !isSuppressedByOwnWarning(w, warnings, calculated));
    warnings.push(...schWarnings);
    for (const ruleSet of result.skipped) warnings.push(ruleSetSkippedWarning(ruleSet));
  }
  return { xml, warnings, profile: calculated.profile, calculated, durationMs: { validate: t1 - t0, serialize: t2 - t1, schematron } };
}

export async function generateXml(input: unknown, options: GenerateXmlOptions = {}): Promise<GenerateXmlResult> {
  const { xml, warnings, profile } = await generateXmlDetailed(input, options);
  return { xml, warnings, profile };
}
