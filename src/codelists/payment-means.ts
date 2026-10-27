/** UNTDID 4461, payment means. Aliases -> code. */
export const PAYMENT_MEANS_ALIAS_MAP: Readonly<Record<string, string>> = {
  'transfer': '58', // SEPA credit transfer
  'sepa-direct-debit': '59', // SEPA direct debit
  'card': '48', // bank card
  'cash': '10', // in cash
};

export const PAYMENT_MEANS_NAMES: Readonly<Record<string, string>> = {
  '1': 'Instrument not defined',
  '10': 'In cash',
  '20': 'Cheque',
  '30': 'Credit transfer',
  '42': 'Payment to bank account',
  '48': 'Bank card',
  '49': 'Direct debit',
  '57': 'Standing agreement',
  '58': 'SEPA credit transfer',
  '59': 'SEPA direct debit',
  '68': 'Online payment service',
  '97': 'Clearing between partners',
  'ZZZ': 'Mutually defined',
};

export type PaymentMeansResolution = { ok: true; code: string } | { ok: false };

export function resolvePaymentMeans(input: string): PaymentMeansResolution {
  const trimmed = input.trim();
  const alias = PAYMENT_MEANS_ALIAS_MAP[trimmed.toLowerCase()];
  if (alias !== undefined) return { ok: true, code: alias };
  if (trimmed in PAYMENT_MEANS_NAMES) return { ok: true, code: trimmed };
  return { ok: false };
}

export const PAYMENT_MEANS_HINT =
  'Aliases: transfer -> 58 (SEPA credit transfer), sepa-direct-debit -> 59, card -> 48, cash -> 10; ' +
  'or a UNTDID 4461 code (' +
  Object.keys(PAYMENT_MEANS_NAMES).join(', ') +
  ').';
