import { describe, expect, it } from 'vitest';
import { extractBusinessTerm, isSuppressedByOwnWarning, schematronViolation, schematronWarning, SCHEMATRON_HINT } from './generate-xml.js';
import * as core from './index.js';

describe('public surface', () => {
  it('exports schema, normalize, calculate, validate, assertValid, RULES, InvoiceError', () => {
    expect(core.InvoiceInputSchema).toBeDefined();
    expect(typeof core.normalize).toBe('function');
    expect(typeof core.calculate).toBe('function');
    expect(typeof core.validate).toBe('function');
    expect(typeof core.assertValid).toBe('function');
    expect(typeof core.parseInvoiceInput).toBe('function');
    expect(core.RULES.length).toBeGreaterThan(100);
    expect(core.InvoiceError).toBeDefined();
  });

  it('pipeline end-to-end: input → normalize → calculate', () => {
    const input: core.InvoiceInput = {
      number: 'RE-2026-00042',
      issueDate: '2026-09-12',
      seller: { name: 'Musterwerk GmbH', address: { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' }, vatId: 'DE123456789' },
      buyer: { name: 'Beispiel & Söhne KG', address: { street: 'Hauptstraße 1', city: 'Berlin', postalCode: '10115', country: 'DE' } },
      payment: { means: 'transfer', iban: 'DE89370400440532013000' },
      lines: [
        { name: 'Beratung Rechnungsformat', quantity: 12, unit: 'Stunde', unitPrice: '95.00', vat: { category: 'S', rate: 19 } },
        { name: 'API-Integration ZUGFeRD', quantity: 1, unit: 'Pauschale', unitPrice: 2490, vat: { category: 'S', rate: 19 } },
        { name: 'Lizenz Prüfmodul', quantity: 3, unit: 'Monat', unitPrice: '49.90', vat: { category: 'S', rate: 19 } },
      ],
    };
    const result = core.calculate(core.normalize(input));
    expect(result.lines.map((l) => l.unitCode)).toEqual(['HUR', 'LS', 'MON']);
    expect(result.payment?.meansCode).toBe('58');
    // 1140 + 2490 + 149.70 = 3779.70; × 19 % = 718.143 → 718.14
    expect(core.toFixed2(result.totals.lineTotal)).toBe('3779.70');
    expect(core.toFixed2(result.totals.taxTotal)).toBe('718.14');
    expect(core.toFixed2(result.totals.payableAmount)).toBe('4497.84');
  });

  it('end-to-end example: reverse charge without buyer VAT ID → exactly BR-AE-02', () => {
    const input: core.InvoiceInput = {
      number: 'RE-2026-00043',
      issueDate: '2026-09-12',
      dueDate: '2026-09-26',
      deliveryDate: '2026-09-10',
      seller: { name: 'Musterwerk GmbH', address: { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' }, vatId: 'DE123456789' },
      buyer: { name: 'Example Ltd.', address: { street: '1 High Street', city: 'Dublin', postalCode: 'D02', country: 'IE' } },
      payment: { means: 'transfer', iban: 'DE89370400440532013000' },
      lines: [{ name: 'Beratung', quantity: 10, unit: 'Stunde', unitPrice: '120.00', vat: { category: 'AE' } }],
    };
    const calculated = core.calculate(core.normalize(input));
    const { violations, warnings } = core.validate(calculated);
    expect(warnings).toEqual([]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      rule: 'BR-AE-02',
      path: 'buyer.vatId',
      businessTerm: 'BT-48',
      message: 'For reverse charge, the VAT identifier of the recipient is required.',
      hint: expect.stringContaining('buyer.vatId'),
    });
    expect(() => core.assertValid(calculated)).toThrow(core.InvoiceError);

    // With the buyer's VAT identifier: valid, VAT exemption reason pre-filled, tax 0
    const ok = core.calculate(core.normalize({ ...input, buyer: { ...input.buyer, vatId: 'IE6388047V' } }));
    expect(core.validate(ok)).toEqual({ violations: [], warnings: [] });
    expect(core.assertValid(ok)).toEqual([]);
    expect(ok.lines[0]?.vat.exemptionReasonCode).toBe('VATEX-EU-AE');
    expect(core.toFixed2(ok.totals.taxTotal)).toBe('0.00');
    expect(core.toFixed2(ok.totals.payableAmount)).toBe('1200.00');
  });

  it('end-to-end: warnings come back without a violation (§ 14 UStG delivery date, due date)', () => {
    const input: core.InvoiceInput = {
      number: 'RE-2026-00044',
      issueDate: '2026-09-12',
      seller: { name: 'Musterwerk GmbH', address: { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' }, vatId: 'DE123456789' },
      buyer: { name: 'Beispiel & Söhne KG', address: { street: 'Hauptstraße 1', city: 'Berlin', postalCode: '10115', country: 'DE' } },
      lines: [{ name: 'Beratung', quantity: 1, unit: 'Stunde', unitPrice: '100.00', vat: { category: 'S', rate: 19 } }],
    };
    const { violations, warnings } = core.validate(core.calculate(core.normalize(input)));
    expect(violations).toEqual([]);
    expect(warnings.map((w) => w.code).sort()).toEqual(['IF-WARN-002', 'IF-WARN-006']);
    expect(warnings.find((w) => w.code === 'IF-WARN-006')?.message).toContain('119,00');
  });

  it('generateXml: end-to-end with Schematron output validation (0 errors, warnings passed through)', async () => {
    const input: core.InvoiceInput = {
      number: 'RE-2026-00045',
      issueDate: '2026-09-12',
      dueDate: '2026-09-26',
      deliveryDate: '2026-09-10',
      seller: { name: 'Musterwerk GmbH', address: { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' }, vatId: 'DE123456789' },
      buyer: { name: 'Beispiel & Söhne KG', address: { street: 'Hauptstraße 1', city: 'Berlin', postalCode: '10115', country: 'DE' } },
      payment: { means: 'transfer', iban: 'DE89370400440532013000' },
      lines: [{ name: 'Beratung <Rechnungsformat>', quantity: 12, unit: 'Stunde', unitPrice: '95.00', vat: { category: 'S', rate: 19 } }],
    };
    const r = await core.generateXml(input);
    expect(r.profile).toBe('en16931');
    expect(r.warnings).toEqual([]);
    expect(r.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rsm:CrossIndustryInvoice')).toBe(true);
    expect(r.xml).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
    expect(r.xml).toContain('<ram:Name>Beispiel &amp; Söhne KG</ram:Name>');
    expect(r.xml).toContain('<ram:Name>Beratung &lt;Rechnungsformat&gt;</ram:Name>');
    expect(r.xml).toContain('<ram:DuePayableAmount>1356.60</ram:DuePayableAmount>');
    // deterministic
    const again = await core.generateXml(input, { skipXmlValidation: true });
    expect(again.xml).toBe(r.xml);
  });

  it('generateXml: semantic violations throw before serialization', async () => {
    const input: core.InvoiceInput = {
      number: 'RE-2026-00046',
      issueDate: '2026-09-12',
      seller: { name: 'Musterwerk GmbH', address: { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' }, vatId: 'DE123456789' },
      buyer: { name: 'Example Ltd.', address: { street: '1 High Street', city: 'Dublin', postalCode: 'D02', country: 'IE' } },
      lines: [{ name: 'Beratung', quantity: 10, unit: 'Stunde', unitPrice: '120.00', vat: { category: 'AE' } }],
    };
    await expect(core.generateXml(input)).rejects.toMatchObject({ name: 'InvoiceError', violations: [expect.objectContaining({ rule: 'BR-AE-02' })] });
  });

  it('Schematron findings are mapped to Violation/Warning (rule ID, input path, business term, hint)', () => {
    const calculated = core.calculate(
      core.normalize({
        number: 'RE-2026-00047',
        issueDate: '2026-09-12',
        seller: { name: 'Musterwerk GmbH', address: { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' }, vatId: 'DE123456789' },
        buyer: { name: 'Beispiel & Söhne KG', address: { street: 'Hauptstraße 1', city: 'Berlin', postalCode: '10115', country: 'DE' } },
        lines: [{ name: 'Beratung', quantity: 1, unit: 'Stunde', unitPrice: '100.00', vat: { category: 'S', rate: 19 } }],
      }),
    );
    const f: core.SvrlFinding = {
      rule: 'BR-CO-15',
      flag: 'fatal',
      location: '/rsm:CrossIndustryInvoice[1]',
      text: '[BR-CO-15]-Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).',
      source: 'EN16931',
    };
    // A violation keeps the raw XPath location unchanged; the scope of 1e is warnings only.
    expect(schematronViolation(f)).toEqual({ rule: 'BR-CO-15', path: '/rsm:CrossIndustryInvoice[1]', businessTerm: 'BT-112', message: f.text, hint: SCHEMATRON_HINT });

    // Known rule (PEPPOL-EN16931-R008): input path instead of XPath, English substituted text, original XPath additionally in `xpath`.
    const r008Location = '/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeDelivery[1]';
    const r008 = schematronWarning({ ...f, rule: 'PEPPOL-EN16931-R008', flag: 'warning', text: '[PEPPOL-EN16931-R008]-Document MUST not contain empty elements. (still status warning)', location: r008Location }, calculated);
    expect(r008.code).toBe('SCH-PEPPOL-EN16931-R008');
    expect(r008.path).toBe('delivery');
    expect(r008.xpath).toBe(r008Location);
    expect(r008.message).not.toContain('MUST not contain empty elements');
    expect(r008.message).toContain('delivery');
    expect(r008.hint).toContain('delivery.date');

    // Unknown rule: the raw Schematron text is kept, path is the empty string (the invoice as a
    // whole) when the location cannot be mapped to an input path; the XPath then only lives in `xpath`.
    const unknown = schematronWarning(f, calculated);
    expect(unknown).toEqual({ code: 'SCH-BR-CO-15', path: '', message: f.text, businessTerm: 'BT-112', xpath: '/rsm:CrossIndustryInvoice[1]' });

    expect(extractBusinessTerm('The group "SELLER CONTACT" (BG-6) must be transmitted.')).toBe('BG-6');
    expect(extractBusinessTerm('no term')).toBeUndefined();
  });

  it('generateXml end-to-end: SCH-PEPPOL-EN16931-R008 is dropped even when a service period is set without a delivery date (golden 02/08)', async () => {
    const input: core.InvoiceInput = {
      number: 'RE-2026-00048',
      issueDate: '2026-09-12',
      dueDate: '2026-09-26',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      seller: { name: 'Musterwerk GmbH', address: { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' }, vatId: 'DE123456789' },
      buyer: { name: 'Beispiel & Söhne KG', address: { street: 'Hauptstraße 1', city: 'Berlin', postalCode: '10115', country: 'DE' } },
      lines: [{ name: 'Beratung', quantity: 1, unit: 'Stunde', unitPrice: '100.00', vat: { category: 'S', rate: 19 } }],
    };
    const { warnings } = await core.generateXml(input);
    // Section 14 UStG is covered via periodStart/periodEnd, and the customer cannot fix the empty
    // delivery without inventing a date; the warning is dropped (like for IF-WARN-002), even without it firing.
    expect(warnings.map((w) => w.code)).not.toContain('SCH-PEPPOL-EN16931-R008');
  });

  it('generateXml end-to-end: SCH-PEPPOL-EN16931-R008 is dropped when IF-WARN-002 already reports the same issue (neither delivery date nor service period)', async () => {
    const input: core.InvoiceInput = {
      number: 'RE-2026-00049',
      issueDate: '2026-09-12',
      seller: { name: 'Musterwerk GmbH', address: { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' }, vatId: 'DE123456789' },
      buyer: { name: 'Beispiel & Söhne KG', address: { street: 'Hauptstraße 1', city: 'Berlin', postalCode: '10115', country: 'DE' } },
      lines: [{ name: 'Beratung', quantity: 1, unit: 'Stunde', unitPrice: '100.00', vat: { category: 'S', rate: 19 } }],
    };
    const { warnings } = await core.generateXml(input);
    expect(warnings.map((w) => w.code)).toContain('IF-WARN-002');
    expect(warnings.map((w) => w.code)).not.toContain('SCH-PEPPOL-EN16931-R008');
  });

  it('isSuppressedByOwnWarning: R008 can only be suppressed at the delivery (path "delivery"), never at another location, not even with IF-WARN-002 in the same result', () => {
    const calculated = core.calculate(
      core.normalize({
        number: 'RE-2026-00050',
        issueDate: '2026-09-12',
        periodStart: '2026-08-01',
        seller: { name: 'Musterwerk GmbH', address: { street: 'Industriestraße 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' }, vatId: 'DE123456789' },
        buyer: { name: 'Beispiel & Söhne KG', address: { street: 'Hauptstraße 1', city: 'Berlin', postalCode: '10115', country: 'DE' } },
        lines: [{ name: 'Beratung', quantity: 1, unit: 'Stunde', unitPrice: '100.00', vat: { category: 'S', rate: 19 } }],
      }),
    );
    const atDelivery = { code: 'SCH-PEPPOL-EN16931-R008', path: 'delivery', message: 'x' };
    const atOther = { code: 'SCH-PEPPOL-EN16931-R008', path: 'seller.name', message: 'x' };

    // At the delivery: suppressed by IF-WARN-002 in the same result.
    expect(isSuppressedByOwnWarning(atDelivery, [{ code: 'IF-WARN-002', path: 'delivery.date', message: 'x' }], calculated)).toBe(true);
    // At the delivery: also suppressed without IF-WARN-002 when periodStart/periodEnd is set (decision 2).
    expect(isSuppressedByOwnWarning(atDelivery, [], calculated)).toBe(true);
    // At a different location (the generic R008 rule would hit a different empty element here): never suppressed,
    // even if IF-WARN-002 happens to occur in the same result.
    expect(isSuppressedByOwnWarning(atOther, [{ code: 'IF-WARN-002', path: 'delivery.date', message: 'x' }], calculated)).toBe(false);
    expect(isSuppressedByOwnWarning(atOther, [], calculated)).toBe(false);
  });
});
