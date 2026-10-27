import { describe, expect, it } from 'vitest';
import { checkBic, checkCreditorId, checkIban } from './iban.js';

describe('checkIban', () => {
  it.each([
    ['DE89370400440532013000', true],
    ['DE89 3704 0044 0532 0130 00', true],
    ['de89370400440532013000', true],
    ['GB82WEST12345698765432', true],
    ['FR7630006000011234567890189', true],
    ['AT611904300234573201', true],
    ['CH9300762011623852957', true],
    ['NL91ABNA0417164300', true],
    ['DE89370400440532013001', false], // checksum
    ['DE8937040044053201300', false], // length (DE = 22)
    ['DE893704004405320130000', false],
    ['XX89370400440532013000', false], // unknown country
    ['1234', false],
    ['', false],
  ])('%s -> %s', (iban, ok) => {
    expect(checkIban(iban).ok).toBe(ok);
  });

  it('states the reason', () => {
    const reason = (iban: string): string => {
      const r = checkIban(iban);
      return r.ok ? '' : r.reason;
    };
    expect(reason('DE8937040044053201300')).toContain('22');
    expect(reason('DE89370400440532013001')).toContain('checksum');
    expect(reason('XX89370400440532013000')).toContain('XX');
  });
});

describe('checkBic', () => {
  it.each([
    ['COBADEFFXXX', true],
    ['COBADEFF', true],
    ['DEUTDEDB110', true],
    ['cobadeffxxx', true],
    ['COBADEF', false],
    ['COBADEFFXX', false],
    ['1234DEFF', false],
  ])('%s -> %s', (bic, ok) => {
    expect(checkBic(bic)).toBe(ok);
  });
});

describe('checkCreditorId (SEPA creditor identifier)', () => {
  it.each([
    ['DE98ZZZ09999999999', true],
    ['DE98 ZZZ 09999999999', true],
    ['DE97ZZZ09999999999', false],
    ['DE98ZZZ0999999999', false],
    ['DEXXZZZ09999999999', false],
    ['', false],
  ])('%s -> %s', (id, ok) => {
    expect(checkCreditorId(id)).toBe(ok);
  });
});
