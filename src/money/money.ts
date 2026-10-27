/**
 * Money helpers built on decimal.js.
 *
 * Rules (EN 16931 / DIN 1333):
 * - Never float arithmetic for sums. All amounts are `Decimal`.
 * - Commercial rounding = half away from zero (2.345 -> 2.35, -2.345 -> -2.35).
 *   Explicitly NOT banker's rounding (ROUND_HALF_EVEN).
 * - Output amounts (BT-1xx) have exactly 2 decimal places; unit prices may have up to 4.
 *
 * We use our own, cloned Decimal constructor, so that the global decimal.js configuration
 * (e.g. set by other packages) does not affect our rounding.
 */
// Named import: decimal.js ships CJS and ESM builds; under NodeNext only the named export carries
// the constructor type (the default import is typed as the CJS module namespace).
import { Decimal as DecimalBase } from 'decimal.js';

export const Decimal = DecimalBase.clone({
  precision: 40,
  rounding: DecimalBase.ROUND_HALF_UP, // half away from zero (decimal.js: "away from zero" for .5)
  toExpNeg: -20,
  toExpPos: 40,
});

export type Decimal = InstanceType<typeof Decimal>;

/** Short constructor. */
export function D(value: DecimalBase.Value): Decimal {
  return new Decimal(value);
}

export const ZERO: Decimal = D(0);
export const ONE: Decimal = D(1);
export const HUNDRED: Decimal = D(100);

export function isDecimal(value: unknown): value is Decimal {
  return Decimal.isDecimal(value);
}

export function add(a: Decimal, b: Decimal): Decimal {
  return a.plus(b);
}

export function sub(a: Decimal, b: Decimal): Decimal {
  return a.minus(b);
}

export function mul(a: Decimal, b: Decimal): Decimal {
  return a.times(b);
}

export function sum(values: Iterable<Decimal>): Decimal {
  let acc = ZERO;
  for (const v of values) acc = acc.plus(v);
  return acc;
}

/** Commercial rounding (half away from zero) to `places` decimal places. */
export function roundHalfAwayFromZero(value: Decimal, places: number): Decimal {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
}

/** Commercial rounding to 2 decimal places (cents). */
export function round2(value: Decimal): Decimal {
  return roundHalfAwayFromZero(value, 2);
}

/** Fixed representation with exactly 2 decimal places and a dot as the separator (XML format). */
export function toFixed2(value: Decimal): string {
  return value.toFixed(2, Decimal.ROUND_HALF_UP);
}

/** Fixed representation with up to `max` decimal places (at least 2), without trailing zeros beyond the 2nd. */
export function toFixedUpTo(value: Decimal, max: number): string {
  const places = Math.min(Math.max(value.decimalPlaces(), 2), max);
  return value.toFixed(places, Decimal.ROUND_HALF_UP);
}

const NUMERIC_STRING = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parses an input value (number or string) to Decimal.
 * Strings with a comma are rejected (no guessing between thousands and decimal separator).
 */
export function fromInput(value: number | string): Decimal {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Amount must be a finite number, got: ${String(value)}`);
    }
    return new Decimal(value);
  }
  const trimmed = value.trim();
  if (trimmed.includes(',')) {
    throw new TypeError(
      `Amount "${value}" contains a comma. The decimal separator is a dot; thousands separators are not allowed (e.g. "1234.50").`,
    );
  }
  if (trimmed === '' || !NUMERIC_STRING.test(trimmed)) {
    throw new TypeError(`Amount "${value}" is not a valid decimal number (expected e.g. "1234.50").`);
  }
  return new Decimal(trimmed);
}
