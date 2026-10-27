import type { InvoiceTypeInput } from '../model/input.js';
import type { InvoiceTypeCode } from '../model/normalized.js';

/** UNTDID 1001: code or alias → code. */
export const INVOICE_TYPE_MAP: Readonly<Record<InvoiceTypeInput, InvoiceTypeCode>> = {
  '380': '380',
  '381': '381',
  '384': '384',
  'invoice': '380',
  'credit-note': '381',
  'correction': '384',
};
