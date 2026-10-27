import { describe, expect, it } from 'vitest';
import { InvoiceError, formatPath, type Violation } from './errors.js';

describe('InvoiceError', () => {
  it('carries the violations and a summary message', () => {
    const violations: Violation[] = [
      { rule: 'IF-NORM-001', path: 'lines[0].unit', message: 'Unknown unit "Kiste".', hint: 'Allowed: piece, ...' },
      { rule: 'IF-NORM-002', path: 'payment.means', businessTerm: 'BT-81', message: 'Unknown payment means.' },
    ];
    const err = new InvoiceError(violations);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InvoiceError');
    expect(err.violations).toEqual(violations);
    expect(err.message).toContain('2 violations');
    expect(err.message).toContain('IF-NORM-001');
    expect(err.message).toContain('lines[0].unit');
  });

  it('is singular for exactly one violation', () => {
    const err = new InvoiceError([{ rule: 'X', path: 'a', message: 'm' }]);
    expect(err.message).toContain('1 violation');
    expect(err.message).not.toContain('1 violations');
  });

  it('throws for an empty list (programming error)', () => {
    expect(() => new InvoiceError([])).toThrow();
  });
});

describe('formatPath', () => {
  it('maps Zod paths to the input notation', () => {
    expect(formatPath(['lines', 0, 'unit'])).toBe('lines[0].unit');
    expect(formatPath(['seller', 'address', 'country'])).toBe('seller.address.country');
    expect(formatPath([])).toBe('');
    expect(formatPath(['lines', 2, 'allowances', 1, 'amount'])).toBe('lines[2].allowances[1].amount');
  });
});
