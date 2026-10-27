/**
 * `generate()`, the core function: input -> { xml, pdf, warnings }.
 *
 *   generateXml (parse -> normalize -> calculate -> validate -> serializeCii -> Schematron)
 *     -> toViewModel -> renderInvoice (react-pdf, template) -> toPdfA3 (pdf-lib: XMP, OutputIntent, factur-x.xml)
 *
 * veraPDF deliberately does NOT run here (JVM, seconds); only in tests/CI. Determinism:
 * CreationDate = issueDate 00:00:00 UTC (or `createdAt`), document ID = SHA-256 over XML +
 * template options + template version + watermark.
 */
import { createHash } from 'node:crypto';
import { InvoiceError } from './errors/index.js';
import { generateXmlDetailed } from './generate-xml.js';
import type { Profile } from './model/input.js';
import { documentId, toPdfA3 } from './pdfa/index.js';
import { fill } from './render/format.js';
import { checkLogo } from './render/images.js';
import { renderInvoice } from './render/render.js';
import { parseTemplateOptions, TEMPLATE_VERSION, type TemplateOptions, type TemplateOptionsInput } from './render/template-options.js';
import { toViewModel } from './render/view-model.js';
import type { Warning } from './validate/index.js';

export interface GenerateOptions {
  /** Template and layout options (`TemplateOptionsSchema`). Default: `classic`. */
  template?: TemplateOptionsInput;
  /** Diagonal text on every page (test mode). */
  watermark?: string;
  /** Skip Schematron output validation (tests, measurement). Default: false. */
  skipXmlValidation?: boolean;
  /** Fail instead of skipping a Factur-X Schematron rule set that is not installed (see `GenerateXmlOptions`). Default: false. */
  requireAllRuleSets?: boolean;
  /** Creation timestamp in the PDF (Info + XMP). Default: `issueDate` 00:00:00 UTC; reproducible. */
  createdAt?: Date;
}

export interface GenerateResult {
  xml: string;
  pdf: Uint8Array;
  warnings: Warning[];
  profile: Profile;
  meta: {
    pages: number;
    xmlBytes: number;
    pdfBytes: number;
    durationMs: { validate: number; serialize: number; schematron: number; render: number; pdfa: number };
  };
}

/** Template options as a stable JSON string (logo bytes as SHA-256), keys sorted; part of the document ID. */
export function templateOptionsFingerprint(o: TemplateOptions): string {
  const plain: Record<string, unknown> = { ...o };
  if (o.logo !== undefined) plain['logo'] = { mime: o.logo.mime, sha256: createHash('sha256').update(o.logo.data).digest('hex') };
  return JSON.stringify(plain, Object.keys(plain).sort());
}

export async function generate(input: unknown, options: GenerateOptions = {}): Promise<GenerateResult> {
  const template = parseTemplateOptions(options.template);
  if (template.logo !== undefined) {
    const violations = checkLogo(template.logo);
    if (violations.length > 0) throw new InvoiceError(violations);
  }
  const x = await generateXmlDetailed(input, {
    ...(options.skipXmlValidation === true ? { skipXmlValidation: true } : {}),
    ...(options.requireAllRuleSets === true ? { requireAllRuleSets: true } : {}),
  });
  const inv = x.calculated;

  const t0 = performance.now();
  const vm = toViewModel(inv, { locale: 'de' });
  const rendered = await renderInvoice(vm, options.watermark === undefined ? { template } : { template, watermark: options.watermark });
  const t1 = performance.now();

  const title = `${vm.title} ${inv.number}`;
  const pdf = await toPdfA3(rendered.pdf, {
    xml: x.xml,
    profile: inv.profile,
    meta: {
      title,
      author: inv.seller.name,
      subject: fill(vm.texts.pdfSubject, { title: vm.title, number: inv.number, date: vm.issueDate }),
      creationDate: options.createdAt ?? new Date(`${inv.issueDate}T00:00:00Z`),
      invoiceNumber: inv.number,
    },
    documentId: documentId([x.xml, templateOptionsFingerprint(template), TEMPLATE_VERSION, options.watermark ?? '']),
  });
  const t2 = performance.now();

  return {
    xml: x.xml,
    pdf,
    warnings: x.warnings,
    profile: inv.profile,
    meta: {
      pages: rendered.pages,
      xmlBytes: Buffer.byteLength(x.xml, 'utf8'),
      pdfBytes: pdf.byteLength,
      durationMs: { ...x.durationMs, render: t1 - t0, pdfa: t2 - t1 },
    },
  };
}
