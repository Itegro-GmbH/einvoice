/**
 * Format checks for payment data: IBAN (ISO 13616, length per country, mod-97), BIC (ISO 9362),
 * SEPA creditor identifier (mod-97 like the IBAN, excluding the business area code).
 * Pure format check, not an existence check of the account.
 */

/** IBAN lengths per country (SWIFT IBAN Registry). */
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28,
  CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18,
  GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32,
  LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15,
  PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27,
  ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

export type IbanCheck = { ok: true; normalized: string } | { ok: false; reason: string };

function mod97(digits: string): number {
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return rem;
}

/** Letters A-Z -> 10-35, digits unchanged. */
function toDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += code >= 65 && code <= 90 ? String(code - 55) : ch;
  }
  return out;
}

export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

export function checkIban(iban: string): IbanCheck {
  const n = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(n)) {
    return { ok: false, reason: 'expected format: 2-letter country code, 2 check digits, then 11-30 characters (letters/digits)' };
  }
  const country = n.slice(0, 2);
  const expected = IBAN_LENGTHS[country];
  if (expected === undefined) return { ok: false, reason: `unknown IBAN country "${country}"` };
  if (n.length !== expected) {
    return { ok: false, reason: `length ${String(n.length)}, ${String(expected)} characters are required for ${country}` };
  }
  if (mod97(toDigits(n.slice(4) + n.slice(0, 4))) !== 1) return { ok: false, reason: 'checksum (mod 97) does not match' };
  return { ok: true, normalized: n };
}

/** BIC per ISO 9362: 8 or 11 characters (bank 4 letters, country 2 letters, location 2, optional branch 3). */
export function checkBic(bic: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic.replace(/\s+/g, '').toUpperCase());
}

/**
 * SEPA creditor identifier: country (2) + check digits (2) + business area code (3) + national identifier (up to 28).
 * Checksum: national identifier + country + "00" -> mod 97 -> 98 - remainder = check digits.
 */
export function checkCreditorId(id: string): boolean {
  const n = id.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(n)) return false;
  const country = n.slice(0, 2);
  const check = n.slice(2, 4);
  const national = n.slice(7);
  const rem = mod97(toDigits(national + country + '00'));
  return String(98 - rem).padStart(2, '0') === check;
}
