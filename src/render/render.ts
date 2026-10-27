/**
 * Rendering: view model + template options → base PDF (not yet PDF/A) via `@react-pdf/renderer` (Node).
 * Single pass: react-pdf knows `totalPages` when rendering the `render` props, so a second pass is not needed
 * (the test in render.test.ts checks "Seite n von m" (page n of m) on every page).
 */
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { ensureFonts } from './fonts.js';
import { TEMPLATES } from './templates/index.js';
import { h } from './templates/shared.js';
import type { TemplateOptions } from './template-options.js';
import type { InvoiceViewModel } from './view-model.js';

export interface RenderOptions {
  template: TemplateOptions;
  /** Diagonal text across each page (test mode, later `sk_test_`). */
  watermark?: string;
}

export interface RenderResult {
  pdf: Uint8Array;
  pages: number;
}

const PAGE_OBJECT = /\/Type\s*\/Page(?![s\w])/g;

export async function renderInvoice(vm: InvoiceViewModel, options: RenderOptions): Promise<RenderResult> {
  ensureFonts();
  const Template = TEMPLATES[options.template.template];
  const props = options.watermark === undefined ? { vm, options: options.template } : { vm, options: options.template, watermark: options.watermark };
  // The template returns a `Document`; react-pdf also accepts an element that renders to a Document.
  const buffer = await renderToBuffer(h(Template, props) as unknown as ReactElement<DocumentProps>);
  const pdf = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const pages = buffer.toString('latin1').match(PAGE_OBJECT)?.length ?? 0;
  return { pdf, pages };
}
