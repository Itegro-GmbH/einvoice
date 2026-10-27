/**
 * Types of the rule catalog.
 *
 * Every rule is an object with a stable ID (an EN 16931 ID such as `BR-AE-02`, an XRechnung ID
 * such as `BR-DE-15`, or our own `IF-*` namespace), a business term, a severity, and a profile
 * restriction. The catalog is machine-readable, for documentation ("which rules do we check")
 * and the "validation errors by rule ID" metric.
 */
import type { Violation } from '../errors/index.js';
import type { CalculatedInvoice } from '../model/calculated.js';
import type { Profile } from '../model/input.js';

/** Non-fatal hint. Same shape as `Violation`, but `code` instead of `rule`. */
export interface Warning {
  /** Warning code, e.g. `IF-WARN-002` or `SCH-PEPPOL-EN16931-R008`. */
  code: string;
  /**
   * Path in the input (never an XPath); for Schematron warnings, the nearest mappable parent
   * path, or `''` (the invoice as a whole) if the Schematron location cannot be mapped to an
   * input path.
   */
  path: string;
  /** EN 16931 business term, if applicable. */
  businessTerm?: string;
  /** Description with concrete values. */
  message: string;
  /** What to do. */
  hint?: string;
  /** Only for Schematron warnings (`code` starts with `SCH-`): the original, simplified XPath location. */
  xpath?: string;
}

export interface ValidationResult {
  violations: Violation[];
  warnings: Warning[];
}

export type RuleSeverity = 'error' | 'warning';

/** What a rule reports; the runner fills in `rule`/`code` and the default business term. */
export interface Finding {
  path: string;
  message: string;
  hint?: string;
  /** Overrides the rule's default business term (e.g. for rules spanning multiple BTs). */
  businessTerm?: string;
}

export interface RuleContext {
  readonly invoice: CalculatedInvoice;
  report(finding: Finding): void;
}

export interface Rule {
  /** Unique rule ID. */
  id: string;
  /** Default business term (BT/BG number). */
  businessTerm?: string;
  severity: RuleSeverity;
  /** Profiles this rule applies to. `undefined` = all. */
  profiles?: readonly Profile[];
  /** Short description (English) for documentation. */
  description: string;
  /** Source of the rule: EN 16931, XRechnung, Factur-X, einvoice. */
  source: 'EN16931' | 'XRechnung' | 'Factur-X' | 'einvoice';
  check(ctx: RuleContext): void;
}
