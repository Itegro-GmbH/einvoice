/**
 * Formatting for the PDF layout (language de). Deliberately without `Intl`, so that the output does not depend on the runtime's
 * ICU data (determinism, GoBD). Amounts use the same basis as the error messages (`validate/format`).
 */
import type { Decimal } from '../money/index.js';
import { fmtAmount, fmtNumber, fmtRate } from '../validate/format.js';
import type { Texts } from './i18n/de.js';

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = { EUR: '€' };

/** 1234.5 EUR → "1.234,50 €"; other currencies with ISO code: "12,30 USD". */
export function fmtMoney(value: Decimal, currency: string): string {
  return `${fmtAmount(value)} ${CURRENCY_SYMBOLS[currency] ?? currency}`;
}

/** Quantities without unnecessary zeros: 2.50 → "2,5", 1500 → "1.500". */
export function fmtQuantity(value: Decimal): string {
  return fmtNumber(value);
}

/** 19 → "19 %", 5.5 → "5,5 %". */
export function fmtPercent(value: Decimal): string {
  return fmtRate(value);
}

/** ISO date (YYYY-MM-DD) → "TT.MM.JJJJ" (German DD.MM.YYYY). */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d ?? ''}.${m ?? ''}.${y ?? ''}`;
}

/** IBAN in groups of four: "DE89 3704 0044 0532 0130 00". */
export function fmtIban(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

/** UN/ECE code → readable unit name; unknown → code. */
export function unitName(code: string, texts: Texts): string {
  return texts.units[code] ?? code;
}

/** Replace the `{key}` placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => String(values[key] ?? ''));
}
