// Type-level consumer check: compiled with `tsc` against the *installed* package (NodeNext
// resolution, strict, skipLibCheck off), so a missing or broken .d.ts shows up here.
import { generate, generateXml, validateXml, extractXml, InvoiceError, TEMPLATE_NAMES, type InvoiceInput, type GenerateResult, type Violation } from '@itegro/einvoice';

const input: InvoiceInput = {
  number: 'INV-1',
  issueDate: '2026-01-01',
  seller: { name: 'A GmbH', address: { street: 'S 1', city: 'Berlin', postalCode: '10115', country: 'DE' }, vatId: 'DE123456789' },
  buyer: { name: 'B GmbH', address: { street: 'S 2', city: 'Berlin', postalCode: '10115', country: 'DE' } },
  lines: [{ name: 'Item', quantity: 1, unit: 'C62', unitPrice: '1.00', vat: { category: 'S', rate: 19 } }],
};

export async function run(): Promise<Uint8Array> {
  const result: GenerateResult = await generate(input, { template: { template: TEMPLATE_NAMES[0] ?? 'classic' } });
  await generateXml(input);
  await validateXml(result.xml, result.profile);
  await extractXml(result.pdf);
  return result.pdf;
}

export function describeError(e: unknown): readonly Violation[] {
  return e instanceof InvoiceError ? e.violations : [];
}
