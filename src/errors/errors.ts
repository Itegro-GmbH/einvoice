/**
 * Error channel: every violation carries a rule ID, a path in the input,
 * optionally the EN 16931 business term, a message with concrete values, and optionally a hint.
 *
 * Namespaces for `rule`:
 * - `IF-SCHEMA-xxx` - structural violations of the input schema (Zod)
 * - `IF-NORM-xxx`   - normalization errors (unknown aliases, unparsable amounts, ...)
 * - `BR-*`, `BR-CO-*`, `BR-S-*` ... - EN 16931 rules (semantic validation)
 */
export interface Violation {
  /** Rule ID, e.g. `BR-CO-17` or `IF-NORM-001`. */
  rule: string;
  /** Path in the input, e.g. `lines[0].unit`; never an XPath. */
  path: string;
  /** EN 16931 business term, e.g. `BT-117`. */
  businessTerm?: string;
  /** Description with concrete values. */
  message: string;
  /** What to do. */
  hint?: string;
}

export class InvoiceError extends Error {
  override readonly name = 'InvoiceError';
  readonly violations: readonly Violation[];

  constructor(violations: readonly Violation[]) {
    if (violations.length === 0) {
      throw new RangeError('InvoiceError requires at least one violation.');
    }
    const n = violations.length;
    const head = n === 1 ? '1 violation' : `${String(n)} violations`;
    const lines = violations.map((v) => `  ${v.rule} @ ${v.path}: ${v.message}`);
    super(`${head}:\n${lines.join('\n')}`);
    this.violations = violations;
  }
}

/** Maps a path made of segments (Zod-style) to the input notation: `lines[0].unit`. */
export function formatPath(segments: readonly PropertyKey[]): string {
  let out = '';
  for (const seg of segments) {
    if (typeof seg === 'number') {
      out += `[${String(seg)}]`;
    } else {
      out += out === '' ? String(seg) : `.${String(seg)}`;
    }
  }
  return out;
}
