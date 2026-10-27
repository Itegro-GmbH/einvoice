/**
 * Semantic validation.
 *
 * Runs after `normalize()` and `calculate()`, before any XML generation. All messages are
 * phrased in terms of the input (`lines[2].vat.rate`, `buyer.vatId`), carry the official
 * rule ID and business term, and cite concrete values using German number formatting
 * (the invoice's own locale for amounts, independent of the API's English message text).
 *
 * `validate()` never throws. `assertValid()` throws `InvoiceError` when violations exist.
 */
import { InvoiceError, type Violation } from '../errors/index.js';
import type { CalculatedInvoice } from '../model/calculated.js';
import { RULES } from './rules.js';
import type { Finding, Rule, ValidationResult, Warning } from './types.js';

export type { Finding, Rule, RuleContext, RuleSeverity, ValidationResult, Warning } from './types.js';

function applies(rule: Rule, invoice: CalculatedInvoice): boolean {
  return rule.profiles === undefined || rule.profiles.includes(invoice.profile);
}

export function validate(invoice: CalculatedInvoice, rules: readonly Rule[] = RULES): ValidationResult {
  const violations: Violation[] = [];
  const warnings: Warning[] = [];

  for (const rule of rules) {
    if (!applies(rule, invoice)) continue;
    const report = (f: Finding): void => {
      const businessTerm = f.businessTerm ?? rule.businessTerm;
      if (rule.severity === 'error') {
        const v: Violation = { rule: rule.id, path: f.path, message: f.message };
        if (businessTerm !== undefined) v.businessTerm = businessTerm;
        if (f.hint !== undefined) v.hint = f.hint;
        violations.push(v);
      } else {
        const w: Warning = { code: rule.id, path: f.path, message: f.message };
        if (businessTerm !== undefined) w.businessTerm = businessTerm;
        if (f.hint !== undefined) w.hint = f.hint;
        warnings.push(w);
      }
    };
    rule.check({ invoice, report });
  }

  return { violations, warnings };
}

/** Like `validate()`, but throws `InvoiceError` when at least one violation exists. Returns the warnings. */
export function assertValid(invoice: CalculatedInvoice, rules: readonly Rule[] = RULES): Warning[] {
  const result = validate(invoice, rules);
  if (result.violations.length > 0) throw new InvoiceError(result.violations);
  return result.warnings;
}
