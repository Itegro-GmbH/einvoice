/**
 * Output validation of the generated CII XML against the official Schematron rule sets (SaxonJS,
 * precompiled SEF).
 *
 * Rule sets per profile:
 * - basic     -> EN16931 + FACTURX-BASIC
 * - en16931   -> EN16931 + FACTURX-EN16931
 * - extended  -> FACTURX-EXTENDED only. EXTENDED is "EN 16931 **conformant**", not "compliant":
 *   allowed extensions (sub-lines with LineStatusReasonCode, SpecifiedLogisticsServiceCharge,
 *   FormattedIssueDateTime on references, ...) violate core rules of the CEN Schematron
 *   (BR-22/23/26, BR-CO-10/12, CII-DT-027 ...); for the official FNFE examples UC10/UC11 that is
 *   15 false positives. The Factur-X EXTENDED rule set contains the EN rules in adapted form
 *   (BR-FXEXT-CO-*), so it alone is authoritative.
 * - xrechnung -> EN16931 + XRECHNUNG (KoSIT). The Factur-X EN16931 Schematron does **not** run
 *   here: it checks BT-24 against the code list {`urn:cen.eu:en16931:2017`} and would report the
 *   XRechnung identifier as an error; substantively the KoSIT rule set covers EN16931 + PEPPOL +
 *   BR-DE.
 *
 * Severities: EN16931 uses `flag="fatal"|"warning"`, Factur-X leaves `flag` empty for errors
 * (-> `error`), KoSIT additionally uses `information`. Errors = fatal|error, warnings =
 * warning|information. Rules that both rule sets carry under the same ID (BR-*, BR-CO-*,
 * BR-CL-*, PEPPOL-*) report them with different context nodes (EN16931:
 * `/rsm:CrossIndustryInvoice`, Factur-X: the totals element). Therefore, only the first rule set
 * that ran (EN16931) is kept per rule ID; multiple hits of the same rule from the **same** source
 * (e.g. per line) are all kept.
 */
import SaxonJS, { type SaxonNode } from 'saxon-js';
import type { Profile } from '../model/input.js';
import { loadSef, RuleSetUnavailableError, type RuleSet } from './artifacts.js';

export type SvrlFlag = 'fatal' | 'error' | 'warning' | 'information';

export interface SvrlFinding {
  /** Schematron rule ID, e.g. `BR-CO-15`, `FX-SCH-A-000595`, `BR-DE-21`. Asserts without an id: `FX-UNNAMED-<n>`. */
  rule: string;
  flag: SvrlFlag;
  /** XPath of the affected node, with prefixes `rsm`/`ram`/`udt`/`qdt`. */
  location: string;
  /** Message text of the rule set (normalized). */
  text: string;
  source: RuleSet;
}

export interface XmlValidationResult {
  errors: SvrlFinding[];
  warnings: SvrlFinding[];
  /**
   * Rule sets that belong to the profile but could not be run because their compiled file is not
   * installed (only the Factur-X rule sets can be missing; see `npx einvoice-setup-facturx`).
   */
  skipped: RuleSet[];
}

export interface ValidateXmlOptions {
  /** Throw `RuleSetUnavailableError` instead of skipping a rule set that is not installed. Default: false. */
  requireAllRuleSets?: boolean;
}

const SVRL_NS = { svrl: 'http://purl.oclc.org/dsdl/svrl' };

const PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100', 'rsm'],
  ['urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100', 'ram'],
  ['urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100', 'udt'],
  ['urn:un:unece:uncefact:data:standard:QualifiedDataType:100', 'qdt'],
];

/**
 * `/*:X[namespace-uri()='…'][1]` (Schematron skeleton, EN16931/Factur-X) resp. `/Q{…}X[1]` (KoSIT)
 * -> `/rsm:X[1]` for the known CII namespaces.
 */
export function simplifyLocation(location: string): string {
  let out = location;
  for (const [uri, prefix] of PREFIXES) {
    out = out.replace(new RegExp(`\\*:([A-Za-z_][\\w.-]*)\\[namespace-uri\\(\\)='${uri}'\\]`, 'g'), `${prefix}:$1`);
    out = out.split(`Q{${uri}}`).join(`${prefix}:`);
  }
  return out;
}

export function ruleSetsFor(profile: Profile): RuleSet[] {
  switch (profile) {
    case 'basic':
      return ['EN16931', 'FACTURX-BASIC'];
    case 'en16931':
      return ['EN16931', 'FACTURX-EN16931'];
    case 'extended':
      return ['FACTURX-EXTENDED'];
    case 'xrechnung':
      return ['EN16931', 'XRECHNUNG'];
  }
}

function toFlag(raw: string | null): SvrlFlag {
  if (raw === 'fatal' || raw === 'warning' || raw === 'information') return raw;
  return 'error';
}

/** Runs exactly one rule set and returns all failed-assert/successful-report as findings. */
export async function runRuleSet(xml: string, ruleSet: RuleSet): Promise<SvrlFinding[]> {
  const result = await SaxonJS.transform({ stylesheetInternal: loadSef(ruleSet), sourceText: xml, destination: 'document' }, 'async');
  const svrl = result.principalResult;
  const nodes = SaxonJS.XPath.evaluate('//svrl:failed-assert | //svrl:successful-report', svrl, {
    namespaceContext: SVRL_NS,
    resultForm: 'array',
  }) as SaxonNode[];
  let unnamed = 0;
  return nodes.map((node) => {
    const id = node.getAttribute('id');
    const text = SaxonJS.XPath.evaluate('normalize-space(svrl:text)', node, { namespaceContext: SVRL_NS }) as string;
    return {
      rule: id !== null && id !== '' ? id : `FX-UNNAMED-${String(++unnamed)}`,
      flag: toFlag(node.getAttribute('flag')),
      location: simplifyLocation(node.getAttribute('location') ?? ''),
      text,
      source: ruleSet,
    };
  });
}

export function isError(f: SvrlFinding): boolean {
  return f.flag === 'fatal' || f.flag === 'error';
}

/**
 * Validates a CII XML against EN 16931 and the profile rule set. Throws on malformed XML.
 * A Factur-X rule set that is not installed is reported in `skipped` (or throws, with `requireAllRuleSets`).
 */
export async function validateXml(xml: string, profile: Profile, options: ValidateXmlOptions = {}): Promise<XmlValidationResult> {
  const findings: SvrlFinding[] = [];
  const skipped: RuleSet[] = [];
  const firstSource = new Map<string, RuleSet>();
  for (const ruleSet of ruleSetsFor(profile)) {
    let ruleFindings: SvrlFinding[];
    try {
      ruleFindings = await runRuleSet(xml, ruleSet);
    } catch (e) {
      if (e instanceof RuleSetUnavailableError && options.requireAllRuleSets !== true) {
        skipped.push(ruleSet);
        continue;
      }
      throw e;
    }
    for (const f of ruleFindings) {
      const owner = firstSource.get(f.rule) ?? ruleSet;
      if (owner !== ruleSet) continue;
      firstSource.set(f.rule, ruleSet);
      findings.push(f);
    }
  }
  return { errors: findings.filter(isError), warnings: findings.filter((f) => !isError(f)), skipped };
}
