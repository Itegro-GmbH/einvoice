import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RULE_SETS, artifactPath, loadSef } from './artifacts.js';
import { runRuleSet, ruleSetsFor, simplifyLocation, validateXml } from './validate-xml.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(here, '..', '..', 'test', 'fixtures', 'minimal-en16931.xml'), 'utf8');

describe('artifacts', () => {
  it('knows five rule sets whose SEF files exist and load as a JSON package', () => {
    expect(RULE_SETS).toEqual(['EN16931', 'FACTURX-BASIC', 'FACTURX-EN16931', 'FACTURX-EXTENDED', 'XRECHNUNG']);
    for (const rs of RULE_SETS) {
      expect(fs.existsSync(artifactPath(rs))).toBe(true);
      const sef = loadSef(rs) as { N?: string };
      expect(sef.N).toBe('package');
      expect(loadSef(rs)).toBe(sef); // cached
    }
  });
});

describe('ruleSetsFor', () => {
  it('EN16931 plus profile Schematron; EXTENDED (conformant, not compliant) Factur-X only; XRechnung without a Factur-X profile', () => {
    expect(ruleSetsFor('basic')).toEqual(['EN16931', 'FACTURX-BASIC']);
    expect(ruleSetsFor('en16931')).toEqual(['EN16931', 'FACTURX-EN16931']);
    expect(ruleSetsFor('extended')).toEqual(['FACTURX-EXTENDED']);
    expect(ruleSetsFor('xrechnung')).toEqual(['EN16931', 'XRECHNUNG']);
  });
});

describe('validateXml', () => {
  it('minimal invoice (EN16931) is error-free', async () => {
    const r = await validateXml(FIXTURE, 'en16931');
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('wrong currency code: BR-CL-04 (EN16931, fatal) and FX-SCH-A-000595 (Factur-X, error) with a readable location', async () => {
    const xml = FIXTURE.replace('<ram:InvoiceCurrencyCode>EUR', '<ram:InvoiceCurrencyCode>EUX');
    const r = await validateXml(xml, 'en16931');
    const ids = r.errors.map((e) => `${e.source}:${e.rule}`);
    expect(ids).toContain('EN16931:BR-CL-04');
    expect(ids).toContain('FACTURX-EN16931:FX-SCH-A-000595');
    const cl04 = r.errors.find((e) => e.rule === 'BR-CL-04');
    expect(cl04?.flag).toBe('fatal');
    expect(cl04?.text).toContain('ISO code list 4217');
    expect(cl04?.location).toBe('/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:ApplicableHeaderTradeSettlement[1]/ram:InvoiceCurrencyCode[1]');
    const fx = r.errors.find((e) => e.rule === 'FX-SCH-A-000595');
    expect(fx?.flag).toBe('error');
    // Both rule sets report BR-CO-15 (with different context nodes); per rule ID, EN16931 wins.
    expect(r.errors.filter((e) => e.rule === 'BR-CO-15')).toHaveLength(1);
    expect(r.errors.find((e) => e.rule === 'BR-CO-15')?.source).toBe('EN16931');
  });

  it('empty element: PEPPOL-EN16931-R008 as a warning (Factur-X), not as an error', async () => {
    const xml = FIXTURE.replace('</ram:SellerTradeParty>', '<ram:URIUniversalCommunication><ram:URIID schemeID="EM"></ram:URIID></ram:URIUniversalCommunication></ram:SellerTradeParty>');
    const r = await validateXml(xml, 'en16931');
    expect(r.warnings.map((w) => w.rule)).toContain('PEPPOL-EN16931-R008');
    expect(r.warnings.find((w) => w.rule === 'PEPPOL-EN16931-R008')?.flag).toBe('warning');
    expect(r.errors.map((e) => e.rule)).not.toContain('PEPPOL-EN16931-R008');
  });

  it('XRechnung rule set on an EN16931 invoice: BR-DE-21 (spec ID) as a warning, PEPPOL-R001 as an error', async () => {
    const r = await validateXml(FIXTURE, 'xrechnung');
    expect(r.errors.map((e) => `${e.source}:${e.rule}`)).toContain('XRECHNUNG:PEPPOL-EN16931-R001');
    expect(r.warnings.map((w) => w.rule)).toContain('BR-DE-21');
  });

  it('Factur-X assert without an id gets a synthetic rule name', async () => {
    const xml = FIXTURE.replace('<ram:InvoiceCurrencyCode>EUR', '<ram:InvoiceCurrencyCode>EUX');
    const findings = await runRuleSet(xml, 'FACTURX-EN16931');
    const unnamed = findings.filter((f) => f.rule.startsWith('FX-UNNAMED'));
    expect(unnamed.length).toBeGreaterThan(0);
    expect(unnamed[0]?.text).toContain('TaxTotalAmount');
  });

  it('malformed XML throws', async () => {
    await expect(validateXml('<rsm:CrossIndustryInvoice>', 'en16931')).rejects.toThrow();
  });
});

describe('simplifyLocation', () => {
  it('replaces namespace-uri() predicates with known prefixes', () => {
    const raw =
      "/*:CrossIndustryInvoice[namespace-uri()='urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100'][1]/*:ExchangedDocument[namespace-uri()='urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100'][1]/*:IssueDateTime[namespace-uri()='urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100'][1]/*:DateTimeString[namespace-uri()='urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100'][1]";
    expect(simplifyLocation(raw)).toBe('/rsm:CrossIndustryInvoice[1]/rsm:ExchangedDocument[1]/ram:IssueDateTime[1]/udt:DateTimeString[1]');
  });
  it('supports the KoSIT notation Q{uri}Name', () => {
    expect(simplifyLocation('/Q{urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100}CrossIndustryInvoice[1]/Q{urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100}ID[1]')).toBe('/rsm:CrossIndustryInvoice[1]/ram:ID[1]');
  });
  it('leaves unknown namespaces and attributes unchanged', () => {
    expect(simplifyLocation("/*:X[namespace-uri()='urn:other'][1]/@id")).toBe("/*:X[namespace-uri()='urn:other'][1]/@id");
  });
});
