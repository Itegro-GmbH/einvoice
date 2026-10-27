/**
 * German number formatting for error messages (not for XML, where `toFixed2` applies instead).
 * This locale is unchanged by the API being English-only: only the message
 * text around these numbers is English, not the number format itself.
 * Deliberately without `Intl.NumberFormat`, so the output does not depend on the runtime's ICU data.
 */
import type { Decimal } from '../money/index.js';

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatFixed(fixed: string): string {
  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [intPart = '0', frac] = unsigned.split('.');
  const grouped = groupThousands(intPart);
  const body = frac === undefined || frac === '' ? grouped : `${grouped},${frac}`;
  return negative ? `-${body}` : body;
}

/** Amount with exactly 2 decimal places: 1234.5 -> "1.234,50". */
export function fmtAmount(value: Decimal): string {
  return formatFixed(value.toFixed(2));
}

/** Number with as many decimal places as needed: 12.3456 -> "12,3456", 3 -> "3". */
export function fmtNumber(value: Decimal): string {
  return formatFixed(value.toFixed());
}

/** Percentage: 19 -> "19 %", 5.5 -> "5,5 %". */
export function fmtRate(value: Decimal): string {
  return `${fmtNumber(value)} %`;
}
