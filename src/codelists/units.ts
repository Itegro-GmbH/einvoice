/**
 * Units: human-readable aliases -> UN/ECE Recommendation 20 codes, plus a small list of the
 * common codes. Unknown values that look like a code (2-3 uppercase letters/digits) are passed
 * through; the code list check is left to the Schematron (Factur-X codedb).
 */

/** Aliases are matched case-insensitively (keys here are lower case). Input aliases stay in their
 * original language (German and English), since these are accepted input values, not API messages. */
export const UNIT_ALIASES: Readonly<Record<string, string>> = {
  'stück': 'C62',
  'stk': 'C62',
  'stk.': 'C62',
  'piece': 'C62',
  'pieces': 'C62',
  'pcs': 'C62',
  'pc': 'C62',
  'unit': 'C62',
  'stunde': 'HUR',
  'stunden': 'HUR',
  'std': 'HUR',
  'std.': 'HUR',
  'h': 'HUR',
  'hour': 'HUR',
  'hours': 'HUR',
  'tag': 'DAY',
  'tage': 'DAY',
  'day': 'DAY',
  'days': 'DAY',
  'kg': 'KGM',
  'kilogramm': 'KGM',
  'kilogram': 'KGM',
  'g': 'GRM',
  'gramm': 'GRM',
  'gram': 'GRM',
  't': 'TNE',
  'tonne': 'TNE',
  'm': 'MTR',
  'meter': 'MTR',
  'metre': 'MTR',
  'cm': 'CMT',
  'mm': 'MMT',
  'km': 'KMT',
  'pauschale': 'LS',
  'pauschal': 'LS',
  'lump': 'LS',
  'lump sum': 'LS',
  'l': 'LTR',
  'liter': 'LTR',
  'litre': 'LTR',
  'ml': 'MLT',
  'm²': 'MTK',
  'm2': 'MTK',
  'qm': 'MTK',
  'm³': 'MTQ',
  'm3': 'MTQ',
  'monat': 'MON',
  'monate': 'MON',
  'month': 'MON',
  'months': 'MON',
  'woche': 'WEE',
  'week': 'WEE',
  'jahr': 'ANN',
  'year': 'ANN',
  'minute': 'MIN',
  'min': 'MIN',
  'sekunde': 'SEC',
  'sec': 'SEC',
  'kwh': 'KWH',
  'mwh': 'MWH',
  'kw': 'KWT',
  'set': 'SET',
  'paar': 'PR',
  'pair': 'PR',
  '%': 'P1',
  'prozent': 'P1',
  'percent': 'P1',
};

/** Common UN/ECE Rec. 20 codes (excerpt, ~40). Completeness is checked by the Schematron. */
export const KNOWN_UNIT_CODES: ReadonlySet<string> = new Set([
  'C62', // one (unit)
  'H87', // piece
  'EA', // each
  'LS', // lump sum
  'SET', // set
  'PR', // pair
  'P1', // percent
  'E48', // service unit
  'E49', // working day
  'NAR', // number of articles
  'HUR', // hour
  'MIN', // minute
  'SEC', // second
  'DAY', // day
  'WEE', // week
  'MON', // month
  'ANN', // year
  'KGM', // kilogram
  'GRM', // gram
  'MGM', // milligram
  'TNE', // tonne
  'MTR', // metre
  'CMT', // centimetre
  'MMT', // millimetre
  'KMT', // kilometre
  'MTK', // square metre
  'CMK', // square centimetre
  'MTQ', // cubic metre
  'LTR', // litre
  'MLT', // millilitre
  'HLT', // hectolitre
  'KWH', // kilowatt hour
  'MWH', // megawatt hour
  'KWT', // kilowatt
  'KMH', // kilometre per hour
  'XBX', // box (Rec. 21)
  'XPK', // package (Rec. 21)
  'XPA', // packet (Rec. 21)
  'XCT', // carton (Rec. 21)
  'XPX', // pallet (Rec. 21)
  'XRO', // roll (Rec. 21)
  'XBG', // bag (Rec. 21)
  'XBO', // bottle (Rec. 21)
  'XCA', // can (Rec. 21)
  'XCR', // crate (Rec. 21)
]);

const CODE_SHAPE = /^[A-Z0-9]{2,3}$/;

/** Result of the unit resolution. */
export type UnitResolution = { ok: true; code: string; source: 'alias' | 'code' | 'passthrough' } | { ok: false };

export function resolveUnit(input: string): UnitResolution {
  const trimmed = input.trim();
  const alias = UNIT_ALIASES[trimmed.toLowerCase()];
  if (alias !== undefined) return { ok: true, code: alias, source: 'alias' };
  if (KNOWN_UNIT_CODES.has(trimmed)) return { ok: true, code: trimmed, source: 'code' };
  if (CODE_SHAPE.test(trimmed)) return { ok: true, code: trimmed, source: 'passthrough' };
  return { ok: false };
}

/** Short, readable list of the most important aliases for error messages (English examples only; the alias map also accepts the German equivalents). */
export const UNIT_ALIAS_HINT =
  'piece|pcs -> C62, hour|h -> HUR, day -> DAY, kg -> KGM, m -> MTR, ' +
  'lump|lump sum -> LS, l|liter -> LTR, m2 -> MTK, month -> MON; or a UN/ECE Rec. 20 code (e.g. "C62").';
