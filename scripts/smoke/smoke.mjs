// Consumer-side smoke test. Plain JavaScript, no TypeScript, no repository access: this file is
// copied into an empty directory next to a fresh `npm install <tarball>` and run from there.
// It proves that the *packed* package works where it is installed: exports resolve, fonts, the ICC
// profile and the Schematron rule sets are found relative to the installed package (not relative
// to the working directory), a PDF/A-3B with embedded XML is produced, and Schematron is clean.
//
// Usage: node smoke.mjs --facturx=absent|present
//   absent   the Factur-X rule sets are not installed (fresh install): generation works, EN 16931
//            and XRechnung rules run, warning IF-WARN-100 reports the missing Factur-X rules.
//   present  after `einvoice-setup-facturx`: all rule sets run, no IF-WARN-100, requireAllRuleSets works.
import assert from 'node:assert/strict';
import os from 'node:os';
import process from 'node:process';

const lib = await import('@itegro/einvoice');
const { generate, generateXml, validateXml, extractXml, InvoiceError, TEMPLATE_NAMES, PROFILES, RuleSetUnavailableError } = lib;

const facturxArg = process.argv.find((a) => a.startsWith('--facturx='))?.slice('--facturx='.length);
if (facturxArg !== 'absent' && facturxArg !== 'present') throw new Error('usage: node smoke.mjs --facturx=absent|present');
const facturxPresent = facturxArg === 'present';

for (const name of ['generate', 'generateXml', 'validateXml', 'extractXml', 'normalize', 'calculate', 'validate', 'serializeCii', 'toPdfA3']) {
  assert.equal(typeof lib[name], 'function', `export ${name} is missing`);
}
assert.deepEqual([...TEMPLATE_NAMES].sort(), ['classic', 'elegant', 'minimal', 'modern']);
assert.deepEqual([...PROFILES].sort(), ['basic', 'en16931', 'extended', 'xrechnung']);

// Working directory must not matter: run everything from an unrelated directory.
process.chdir(os.tmpdir());

/** @param {'basic' | 'en16931' | 'extended' | 'xrechnung'} profile */
function invoice(profile) {
  return {
    profile,
    number: 'INV-2026-0001',
    issueDate: '2026-09-12',
    dueDate: '2026-10-12',
    deliveryDate: '2026-09-05',
    buyerReference: '04011000-12345-03',
    seller: {
      name: 'Example Works GmbH',
      address: { street: 'Industriestrasse 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' },
      vatId: 'DE123456789',
      taxNumber: '93815/08152',
      legalRegistration: { id: 'HRB 12345', scheme: '0002' },
      contact: { name: 'Erika Example', phone: '+49 711 123456-0', email: 'billing@example-works.example' },
      electronicAddress: { scheme: 'EM', value: 'billing@example-works.example' },
    },
    buyer: {
      name: 'Sample Municipality',
      address: { street: 'Rathausplatz 1', city: 'Musterstadt', postalCode: '12345', country: 'DE' },
      electronicAddress: { scheme: '0204', value: '04011000-12345-03' },
      orderReference: 'PO-2026-0042',
      contact: { name: 'Central invoice office', email: 'invoices@sample-municipality.example' },
    },
    payment: { means: '58', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', accountHolder: 'Example Works GmbH', terms: 'Payable within 30 days.', reference: 'INV-2026-0001' },
    lines: [
      { name: 'Consulting', quantity: '12', unit: 'HUR', unitPrice: '95.00', vat: { category: 'S', rate: 19 } },
      { name: 'Integration package', quantity: '1', unit: 'C62', unitPrice: '2490.00', vat: { category: 'S', rate: 19 } },
    ],
  };
}

// 1x1 transparent PNG, exercises the image path of the renderer.
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let checks = 0;

/** Generates one PDF and verifies all properties a consumer relies on. */
async function check(profile, template, extra = {}) {
  const label = `${profile}/${template}`;
  const result = await generate(invoice(profile), { template: { template, ...extra } });
  const { xml, pdf, warnings, meta } = result;

  const head = Buffer.from(pdf.subarray(0, 8)).toString('latin1');
  assert.match(head, /^%PDF-1\.\d/, `${label}: not a PDF`);
  assert.ok(meta.pages >= 1 && meta.pdfBytes === pdf.length, `${label}: bad meta`);
  assert.ok(Array.isArray(warnings), `${label}: warnings must be an array`);
  // Without the Factur-X rule sets, exactly the profiles that need them report IF-WARN-100.
  const needsFacturx = profile !== 'xrechnung';
  assert.equal(warnings.some((w) => w.code === 'IF-WARN-100'), needsFacturx && !facturxPresent, `${label}: IF-WARN-100 expectation violated (${warnings.map((w) => w.code).join(',')})`);

  // PDF/A-3B markers (the XMP packet and the OutputIntent are stored uncompressed).
  const raw = Buffer.from(pdf).toString('latin1');
  assert.ok(raw.includes('<pdfaid:part>3</pdfaid:part>') && raw.includes('<pdfaid:conformance>B</pdfaid:conformance>'), `${label}: PDF/A-3B XMP missing`);
  assert.ok(raw.includes('GTS_PDFA1'), `${label}: OutputIntent missing`);
  assert.ok(raw.includes('factur-x.xml'), `${label}: embedded file name missing`);

  // The embedded XML is exactly the XML that was returned.
  const embedded = await extractXml(pdf);
  assert.ok(embedded !== null, `${label}: no embedded XML`);
  assert.equal(embedded.xml, xml, `${label}: embedded XML differs from returned XML`);
  assert.equal(embedded.filename, 'factur-x.xml');

  // Schematron (EN 16931 + profile rule set) reports no error and no fatal finding.
  const sch = await validateXml(embedded.xml, profile);
  assert.deepEqual(sch.errors.map((f) => `${f.rule}: ${f.text}`), [], `${label}: Schematron errors`);
  assert.equal(sch.skipped.length > 0, needsFacturx && !facturxPresent, `${label}: unexpected skipped rule sets ${sch.skipped.join(',')}`);
  if (facturxPresent) {
    const strict = await validateXml(embedded.xml, profile, { requireAllRuleSets: true });
    assert.deepEqual(strict.errors, [], `${label}: strict Schematron errors`);
  }

  checks++;
  return result;
}

for (const profile of PROFILES) await check(profile, 'classic');
for (const template of TEMPLATE_NAMES) await check('en16931', template, template === 'modern' ? { accentColor: '#1f4e79', logo: { data: PNG_1X1, mime: 'image/png' }, footerText: 'Thank you for your business.' } : {});

// Byte-identical reproducibility: same input and options give the same PDF.
const a = await generate(invoice('en16931'));
const b = await generate(invoice('en16931'));
assert.ok(Buffer.compare(Buffer.from(a.pdf), Buffer.from(b.pdf)) === 0, 'PDF is not reproducible');
checks++;

// A missing rule set can be turned into a hard failure.
if (!facturxPresent) {
  await assert.rejects(() => generate(invoice('en16931'), { requireAllRuleSets: true }), (e) => e instanceof RuleSetUnavailableError && /einvoice-setup-facturx/.test(e.message));
  checks++;
}

// XML only.
const onlyXml = await generateXml(invoice('xrechnung'));
assert.ok(onlyXml.xml.includes('urn:xeinkauf.de:kosit:xrechnung_3.0'), 'XRechnung specification identifier missing');
checks++;

// Structured errors.
const bad = invoice('en16931');
bad.lines = [{ name: 'Consulting', quantity: '1', unit: 'HUR', unitPrice: '10.00', vat: { category: 'AE' } }];
bad.buyer.address.country = 'IE';
delete bad.buyer.electronicAddress;
await assert.rejects(
  () => generate(bad),
  (e) => {
    assert.ok(e instanceof InvoiceError, 'expected InvoiceError');
    assert.ok(e.violations.length > 0);
    for (const v of e.violations) {
      assert.equal(typeof v.rule, 'string');
      assert.equal(typeof v.path, 'string');
      assert.equal(typeof v.message, 'string');
    }
    return true;
  },
);
checks++;

console.log(`smoke[facturx=${facturxArg}]: ${checks} checks passed on ${process.platform}/${process.arch}, node ${process.version}`);
