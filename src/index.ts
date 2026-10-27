/**
 * @itegro/einvoice, public surface.
 *
 * Pipeline: InvoiceInput -> normalize() -> NormalizedInvoice -> calculate() -> CalculatedInvoice
 *           -> validate() -> { violations, warnings }  (or assertValid(), which throws on violations)
 *           -> serializeCii() -> XML -> validateXml() (Schematron output validation).
 * `generateXml()` ties this together; `generate()` adds rendering (react-pdf) and PDF/A-3 (pdf-lib).
 */

// Input model (Zod) and types
export {
  InvoiceInputSchema,
  parseInvoiceInput,
  PROFILES,
  VAT_CATEGORIES,
  INVOICE_TYPE_CODES,
  PAYMENT_MEANS_CODES,
  type InvoiceInput,
  type ParsedInvoiceInput,
  type Profile,
  type VatCategory,
  type PartyInput,
  type SellerInput,
  type BuyerInput,
  type DeliveryInput,
  type PrecedingInvoiceInput,
  type LineInput,
  type VatInput,
  type PaymentInput,
  type LineAllowanceChargeInput,
  type DocumentAllowanceChargeInput,
  type AmountInput,
} from './model/input.js';

// Internal model
export type {
  NormalizedInvoice,
  NormalizedLine,
  NormalizedParty,
  NormalizedBuyer,
  NormalizedDelivery,
  NormalizedPrecedingInvoice,
  NormalizedLegalRegistration,
  NormalizedPayment,
  NormalizedVat,
  NormalizedLineAllowanceCharge,
  NormalizedDocumentAllowanceCharge,
  InvoiceTypeCode,
} from './model/normalized.js';
export type {
  CalculatedInvoice,
  CalculatedLine,
  CalculatedLineAllowanceCharge,
  CalculatedDocumentAllowanceCharge,
  VatBreakdownEntry,
  InvoiceTotals,
} from './model/calculated.js';

// Processing
export { normalize } from './normalize/index.js';
export { calculate } from './calculate/index.js';
export { validate, assertValid, RULES, findRule, type Rule, type ValidationResult } from './validate/index.js';

// CII serialization and Schematron output validation
export { serializeCii } from './serialize/index.js';
export { validateXml, ruleSetsFor, RULE_SETS, FACTURX_RULE_SETS, RuleSetUnavailableError, preloadAll, type SvrlFinding, type SvrlFlag, type ValidateXmlOptions, type XmlValidationResult, type RuleSet } from './xml-validate/index.js';
export { setupFacturx as installFacturxRuleSets, type SetupOptions as InstallFacturxRuleSetsOptions } from './xml-validate/facturx-setup.js';
export { generateXml, type GenerateXmlOptions, type GenerateXmlResult } from './generate-xml.js';

// Rendering, PDF/A-3, and generate()
export { generate, templateOptionsFingerprint, type GenerateOptions, type GenerateResult } from './generate.js';
export { toPdfA3, extractXml, documentId, CONFORMANCE_LEVELS, XML_FILENAME, type PdfA3Options, type PdfMeta, type ExtractedXml } from './pdfa/index.js';
export {
  toViewModel,
  renderInvoice,
  TemplateOptionsSchema,
  parseTemplateOptions,
  TEMPLATE_VERSION,
  TEMPLATE_NAMES,
  TEMPLATE_DESCRIPTIONS,
  TEMPLATES,
  checkLogo,
  type InvoiceViewModel,
  type TemplateOptions,
  type TemplateOptionsInput,
  type TemplateName,
  type RenderOptions,
  type RenderResult,
} from './render/index.js';

// Error and warning channel
export { InvoiceError, type Violation } from './errors/index.js';
export type { Warning } from './validate/index.js';

// Money
export { Decimal, D, round2, toFixed2, fromInput } from './money/index.js';
