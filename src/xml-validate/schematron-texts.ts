/**
 * English texts (`message`, optional `hint`) for known Schematron rules that are passed through
 * as an `SCH-*` warning. Unknown rules keep their original Schematron text
 * unchanged.
 *
 * Scope: at least every rule triggered by our own golden fixtures or tests (see
 * docs/reports/phase1e.md); currently `PEPPOL-EN16931-R008` (golden fixtures 02 and 08: billing
 * period without a delivery date, `ApplicableHeaderTradeDelivery` stays empty). At delivery, this
 * warning is by now almost always suppressed via `SCHEMATRON_SUPPRESSED_BY` (IF-WARN-002 or a set
 * billing period); text/hint remain as a fallback in case the suppression
 * does not apply at some point (e.g. a future change to the condition).
 */
import type { CalculatedInvoice } from '../model/calculated.js';

export interface SchematronText {
  message: string;
  hint?: string;
}

export const SCHEMATRON_TEXTS: Readonly<Record<string, SchematronText>> = {
  'PEPPOL-EN16931-R008': {
    message:
      'The delivery (delivery) is a mandatory element per the schema, but is empty here: neither a delivery date nor a delivery address is given.',
    hint:
      'Provide delivery.date (or deliveryDate) or delivery.address. If a billing period is given instead (periodStart/periodEnd), or IF-WARN-002 is already present, this warning is suppressed automatically; the date of delivery or supply for Section 14(4) No. 6 of the German VAT Act (UStG) is already covered by that.',
  },
};

/** A suppression rule for a generic Schematron rule (e.g. "Document MUST not contain empty elements"). */
export interface SchematronSuppression {
  /** `code` of our own warning that takes precedence when present in the same result. */
  by: string;
  /**
   * Only applies when the mapped input path of the SCH warning matches this value exactly;
   * prevents a generic rule (in principle matching any empty element) from being suppressed
   * elsewhere just because `by` happens to occur in the same result.
   */
  requiredPath: string;
  /** Additional condition under which the warning is also dropped without `by` (e.g. a set billing period). */
  alsoIf?: (invoice: CalculatedInvoice) => boolean;
}

/**
 * If a warning of our own already reports the same fact in input terms in the same result (or
 * `alsoIf` applies), the associated SCH warning is dropped, but only if its input path matches
 * `requiredPath`. Key: Schematron rule ID
 * (without the `SCH-` prefix).
 */
export const SCHEMATRON_SUPPRESSED_BY: Readonly<Record<string, SchematronSuppression>> = {
  'PEPPOL-EN16931-R008': {
    by: 'IF-WARN-002',
    requiredPath: 'delivery',
    // Section 14 UStG is covered via periodStart/periodEnd, and the customer cannot fix the empty
    // delivery without inventing a date.
    alsoIf: (invoice) => invoice.periodStart !== undefined || invoice.periodEnd !== undefined,
  },
};
