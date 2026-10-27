import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateXml } from '../generate-xml.js';
import { loadFixtures } from '../../test/golden/fixtures.js';
import { RuleSetUnavailableError } from './artifacts.js';
import { applyPatches, FACTURX_SOURCES, inlineCodedb, setupFacturx, sha256 } from './facturx-setup.js';
import { validateXml } from './validate-xml.js';

describe('inlineCodedb', () => {
  const xslt = `<?xml version="1.0"?>\n<xsl:stylesheet version="2.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="/"><xsl:value-of select="document('X_codedb.xml')//cl"/></xsl:template></xsl:stylesheet>`;

  it('embeds the code list as a string variable and replaces the document() calls', () => {
    const r = inlineCodedb(xslt, '<?xml version="1.0"?>\n<!-- header -->\n<codedb><cl id="1">a&amp;b</cl></codedb>', 'X_codedb.xml');
    expect(r.occurrences).toBe(1);
    expect(r.text).not.toContain('document(');
    expect(r.text).toContain('$fxCodedb');
    expect(r.text).toContain('&lt;codedb>&lt;cl id="1">a&amp;amp;b&lt;/cl>&lt;/codedb>');
    expect(r.text).not.toContain('header');
  });

  it('fails if the stylesheet does not call document() for the code list', () => {
    expect(() => inlineCodedb('<xsl:stylesheet/>', '<codedb/>', 'X_codedb.xml')).toThrow(/No document/);
  });
});

describe('applyPatches', () => {
  it('replaces exactly the expected number of occurrences', () => {
    expect(applyPatches('a b a', [{ from: 'a', to: 'c', expect: 2 }], 'x')).toBe('c b c');
  });

  it('aborts when the occurrence count differs (upstream changed)', () => {
    expect(() => applyPatches('a b', [{ from: 'a', to: 'c', expect: 2 }], 'x')).toThrow(/found 1 times, expected 2/);
  });
});

describe('setupFacturx', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'einvoice-setup-test-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a download whose checksum does not match the pinned one', async () => {
    const fetchFn = () => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new TextEncoder().encode('tampered').buffer) });
    await expect(setupFacturx({ dir, fetchFn, compile: () => undefined, only: ['BASIC'] })).rejects.toThrow(/Checksum mismatch/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('reports HTTP failures', async () => {
    const fetchFn = () => Promise.resolve({ ok: false, status: 404, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    await expect(setupFacturx({ dir, fetchFn, compile: () => undefined, only: ['BASIC'] })).rejects.toThrow(/HTTP 404/);
  });

  it('pins a SHA-256 per downloaded file', () => {
    for (const s of FACTURX_SOURCES) {
      expect(s.xsltSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.codedbSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('missing Factur-X rule sets', () => {
  const previous = process.env['EINVOICE_FACTURX_DIR'];
  let empty: string;
  beforeEach(() => {
    empty = fs.mkdtempSync(path.join(os.tmpdir(), 'einvoice-empty-'));
    process.env['EINVOICE_FACTURX_DIR'] = empty;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env['EINVOICE_FACTURX_DIR'];
    else process.env['EINVOICE_FACTURX_DIR'] = previous;
    fs.rmSync(empty, { recursive: true, force: true });
  });

  const fixture = (name: string) => {
    const f = loadFixtures().find((x) => x.name.startsWith(name));
    if (f === undefined) throw new Error(`fixture ${name} not found`);
    return f;
  };

  it('validateXml skips the missing rule set and reports it; EN 16931 still runs', async () => {
    const f = fixture('01-');
    const r = await validateXml(fs.readFileSync(f.xmlPath, 'utf8'), 'en16931');
    expect(r.skipped).toEqual(['FACTURX-EN16931']);
    expect(r.errors).toEqual([]);
  });

  it('validateXml throws RuleSetUnavailableError with requireAllRuleSets', async () => {
    const f = fixture('01-');
    await expect(validateXml(fs.readFileSync(f.xmlPath, 'utf8'), 'en16931', { requireAllRuleSets: true })).rejects.toBeInstanceOf(RuleSetUnavailableError);
  });

  it('generateXml adds warning IF-WARN-100 with the setup hint', async () => {
    const f = fixture('01-');
    const r = await generateXml(f.input);
    const w = r.warnings.find((x) => x.code === 'IF-WARN-100');
    expect(w?.message).toContain('FACTURX-EN16931');
    expect(w?.hint).toContain('einvoice-setup-facturx');
  });

  it('XRechnung does not need the Factur-X rule sets and gets no IF-WARN-100', async () => {
    const f = fixture('09-');
    const r = await generateXml(f.input);
    expect(r.warnings.map((x) => x.code)).not.toContain('IF-WARN-100');
  });
});
