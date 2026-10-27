/**
 * Rule catalog, machine-readable. Order = reporting order.
 * IDs must be unique (tested in rules.test.ts).
 */
import { CATEGORY_RULES } from './rules/categories.js';
import { DECIMALS_RULES, DOCUMENT_RULES } from './rules/document.js';
import { PARTY_RULES } from './rules/parties.js';
import { PAYMENT_RULES } from './rules/payment.js';
import { BASIC_RULES, XRECHNUNG_RULES } from './rules/profiles.js';
import { TOTALS_RULES } from './rules/totals.js';
import { WARNING_RULES } from './rules/warnings.js';
import type { Rule } from './types.js';

export const RULES: readonly Rule[] = [
  ...DOCUMENT_RULES,
  ...PARTY_RULES,
  ...CATEGORY_RULES,
  ...TOTALS_RULES,
  ...DECIMALS_RULES,
  ...PAYMENT_RULES,
  ...XRECHNUNG_RULES,
  ...BASIC_RULES,
  ...WARNING_RULES,
];

export function findRule(id: string): Rule | undefined {
  return RULES.find((r) => r.id === id);
}
