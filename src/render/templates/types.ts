import type { ReactElement } from 'react';
import type { TemplateOptions } from '../template-options.js';
import type { InvoiceViewModel } from '../view-model.js';

export interface TemplateProps {
  vm: InvoiceViewModel;
  options: TemplateOptions;
  /** Diagonal text across each page (test mode). */
  watermark?: string;
}

/** A template is a function that returns the react-pdf `Document`. */
export type Template = (props: TemplateProps) => ReactElement;
