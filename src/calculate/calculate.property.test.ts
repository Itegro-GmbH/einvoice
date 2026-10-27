/**
 * Property-based tests (fast-check) for the calculation logic.
 * For arbitrary line lists, rates, categories and allowances/charges the
 * EN 16931 consistency rules BR-CO-10 … BR-CO-17 and BR-S-08 must hold.
 */
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { invoiceArb, vatArb } from '../../test/arbitraries.js';
import { D, HUNDRED, round2, sum, type Decimal } from '../money/index.js';
import type { NormalizedInvoice, NormalizedVat } from '../model/normalized.js';
import { calculate } from './calculate.js';

const NUM_RUNS = 500;

const eq = (a: Decimal, b: Decimal): boolean => a.eq(b);
const has2dp = (d: Decimal): boolean => d.decimalPlaces() <= 2 && d.isFinite();

describe('calculate – Eigenschaften (fast-check)', () => {
  it('BR-CO-10: BT-106 = Σ BT-131', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const c = calculate(inv);
        return eq(c.totals.lineTotal, sum(c.lines.map((l) => l.netAmount)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('BR-CO-11/12: BT-107 = Σ BT-92, BT-108 = Σ BT-99', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const c = calculate(inv);
        return (
          eq(c.totals.allowanceTotal, sum(c.allowances.map((a) => a.amount))) &&
          eq(c.totals.chargeTotal, sum(c.charges.map((a) => a.amount)))
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('BR-CO-13: BT-109 = BT-106 − BT-107 + BT-108', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const t = calculate(inv).totals;
        return eq(t.taxExclusiveAmount, t.lineTotal.minus(t.allowanceTotal).plus(t.chargeTotal));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('BR-CO-14: BT-110 = Σ BT-117', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const c = calculate(inv);
        return eq(c.totals.taxTotal, sum(c.vatBreakdown.map((b) => b.taxAmount)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('BR-CO-15: BT-112 = BT-109 + BT-110', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const t = calculate(inv).totals;
        return eq(t.taxInclusiveAmount, t.taxExclusiveAmount.plus(t.taxTotal));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('BR-CO-16: BT-115 = BT-112 − BT-113 + BT-114', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const t = calculate(inv).totals;
        return (
          eq(t.payableAmount, t.taxInclusiveAmount.minus(t.prepaidAmount).plus(t.roundingAmount)) &&
          eq(t.prepaidAmount, inv.prepaidAmount) &&
          eq(t.roundingAmount, inv.roundingAmount)
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('BR-CO-17: per breakdown BT-117 = round2(BT-116 × rate / 100)', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const c = calculate(inv);
        return c.vatBreakdown.every((b) => eq(b.taxAmount, round2(b.taxableAmount.times(b.rate).div(HUNDRED))));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('BR-S-08 (and Z/E/AE/K-08): per breakdown BT-116 = Σ BT-131 − Σ BT-92 + Σ BT-99 of the same (category, rate)', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const c = calculate(inv);
        return c.vatBreakdown.every((b) => {
          const same = (v: NormalizedVat): boolean => v.category === b.category && v.rate.eq(b.rate);
          const expected = sum(c.lines.filter((l) => same(l.vat)).map((l) => l.netAmount))
            .minus(sum(c.allowances.filter((a) => same(a.vat)).map((a) => a.amount)))
            .plus(sum(c.charges.filter((a) => same(a.vat)).map((a) => a.amount)));
          return eq(b.taxableAmount, expected);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Σ BT-116 over all breakdowns = BT-109', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const c = calculate(inv);
        return eq(sum(c.vatBreakdown.map((b) => b.taxableAmount)), c.totals.taxExclusiveAmount);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('each (category, rate) combination appears exactly once in the breakdown', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const c = calculate(inv);
        const keys = c.vatBreakdown.map((b) => `${b.category}|${b.rate.toString()}`);
        const used = new Set([...c.lines.map((l) => l.vat), ...c.allowances.map((a) => a.vat), ...c.charges.map((a) => a.vat)].map((v) => `${v.category}|${v.rate.toString()}`));
        return new Set(keys).size === keys.length && keys.length === used.size && keys.every((k) => used.has(k));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Line: BT-131 = round2(gross − Σ allowances + Σ charges), gross = qty × price / base', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const c = calculate(inv);
        return c.lines.every((l) => {
          const gross = l.quantity.times(l.unitPrice).div(l.priceBaseQuantity);
          const expected = round2(gross.minus(sum(l.allowances.map((a) => a.amount))).plus(sum(l.charges.map((a) => a.amount))));
          return eq(l.grossAmount, gross) && eq(l.netAmount, expected);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('all output amounts are finite and have at most 2 decimal places', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const c = calculate(inv);
        return (
          Object.values(c.totals).every(has2dp) &&
          c.vatBreakdown.every((b) => has2dp(b.taxableAmount) && has2dp(b.taxAmount)) &&
          c.lines.every((l) => has2dp(l.netAmount) && [...l.allowances, ...l.charges].every((a) => has2dp(a.amount))) &&
          [...c.allowances, ...c.charges].every((a) => has2dp(a.amount) && has2dp(a.baseAmount))
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic and idempotent; the input is not mutated', () => {
    fc.assert(
      fc.property(invoiceArb, (inv) => {
        const before = JSON.stringify(inv);
        const a = JSON.stringify(calculate(inv));
        const b = JSON.stringify(calculate(inv));
        return a === b && JSON.stringify(inv) === before;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reference implementation with integer cents yields the same totals (whole cents only, base 1, no percentages)', () => {
    // Independent second calculation using integer cent arithmetic as an oracle.
    const centLineArb = fc.record({
      qty: fc.integer({ min: -1000, max: 1000 }),
      priceCents: fc.integer({ min: 0, max: 1_000_000 }),
      vat: vatArb,
    });
    fc.assert(
      fc.property(fc.array(centLineArb, { minLength: 1, maxLength: 30 }), (lines) => {
        const inv: NormalizedInvoice = {
          profile: 'en16931',
          profileUrn: 'urn:cen.eu:en16931:2017',
          number: 'ORACLE',
          typeCode: '380',
          issueDate: '2026-09-12',
          currency: 'EUR',
          notes: [],
          precedingInvoices: [],
          seller: { name: 'S', address: { street: 's', city: 'c', postalCode: '1', country: 'DE' } },
          buyer: { name: 'B', address: { street: 's', city: 'c', postalCode: '1', country: 'DE' } },
          lines: lines.map((l, i) => ({
            id: String(i + 1),
            name: 'x',
            quantity: D(l.qty),
            unitCode: 'C62',
            unitPrice: D(l.priceCents).div(100),
            priceBaseQuantity: D(1),
            vat: l.vat,
            allowances: [],
            charges: [],
          })),
          allowances: [],
          charges: [],
          prepaidAmount: D(0),
          roundingAmount: D(0),
        };
        const c = calculate(inv);

        // Oracle: integer cents, BigInt for safety, half away from zero via rounding the tenth-of-a-cent.
        const groups = new Map<string, { rateTenths: bigint; basisCents: bigint }>();
        let lineTotalCents = 0n;
        for (const l of lines) {
          const cents = BigInt(l.qty) * BigInt(l.priceCents);
          lineTotalCents += cents;
          const key = `${l.vat.category}|${l.vat.rate.toString()}`;
          const g = groups.get(key) ?? { rateTenths: BigInt(l.vat.rate.times(10).toString()), basisCents: 0n };
          g.basisCents += cents;
          groups.set(key, g);
        }
        const halfAway = (num: bigint, den: bigint): bigint => {
          // num/den to an integer, half away from zero
          const sign = num < 0n ? -1n : 1n;
          const abs = num < 0n ? -num : num;
          return sign * ((abs * 2n + den) / (2n * den));
        };
        let taxCents = 0n;
        for (const g of groups.values()) {
          // basis × rate/100, rate = rateTenths/10 → basis × rateTenths / 1000
          taxCents += halfAway(g.basisCents * g.rateTenths, 1000n);
        }
        const fromCents = (x: bigint): Decimal => D(x.toString()).div(100);
        return (
          eq(c.totals.lineTotal, fromCents(lineTotalCents)) &&
          eq(c.totals.taxTotal, fromCents(taxCents)) &&
          eq(c.totals.payableAmount, fromCents(lineTotalCents + taxCents))
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
