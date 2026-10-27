import { describe, expect, it } from 'vitest';
import { RULES } from './rules.js';

describe('rule catalog', () => {
  it('all rule IDs are unique', () => {
    const ids = RULES.map((r) => r.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it('IDs follow the known namespaces', () => {
    for (const r of RULES) {
      expect(r.id, r.id).toMatch(/^(BR(-[A-Z]+)?-\d{1,2}(-[a-z])?|BR-DE-\d{1,2}(-[a-z])?|IF-(WARN|DEC|PAY|VAT|XR|PROFILE)-\d{3})$/);
    }
  });

  it('warnings carry IF-WARN- or a third-party rule declared as a warning; errors never IF-WARN-', () => {
    for (const r of RULES) {
      if (r.id.startsWith('IF-WARN-')) expect(r.severity, r.id).toBe('warning');
      if (r.severity === 'error') expect(r.id.startsWith('IF-WARN-'), r.id).toBe(false);
    }
  });

  it('every rule has a description and a source', () => {
    for (const r of RULES) {
      expect(r.description.length, r.id).toBeGreaterThan(10);
      expect(['EN16931', 'XRechnung', 'Factur-X', 'einvoice']).toContain(r.source);
    }
  });
});

describe('rule catalog - coverage', () => {
  const ids = new Set(RULES.map((r) => r.id));

  it('contains the EN 16931 rules required by task 1b', () => {
    const required = [
      'BR-01', 'BR-02', 'BR-03', 'BR-04', 'BR-05', 'BR-06', 'BR-07', 'BR-09', 'BR-11', 'BR-16', 'BR-29',
      'BR-CO-09', 'BR-CO-17', 'BR-CO-26',
      'BR-S-01', 'BR-S-02', 'BR-S-05', 'BR-S-08', 'BR-S-10',
      'BR-Z-05', 'BR-Z-09', 'BR-Z-10',
      'BR-E-05', 'BR-E-10',
      'BR-AE-02', 'BR-AE-03', 'BR-AE-04', 'BR-AE-05', 'BR-AE-10',
      'BR-IC-02', 'BR-IC-03', 'BR-IC-04', 'BR-IC-05', 'BR-IC-10', 'BR-IC-11', 'BR-IC-12',
      'BR-G-02', 'BR-G-05', 'BR-G-10',
      'BR-O-02', 'BR-O-05', 'BR-O-10', 'BR-O-11', 'BR-O-12', 'BR-O-13', 'BR-O-14',
      'BR-AF-05', 'BR-AG-05',
      'BR-DEC-01', 'BR-DEC-05', 'BR-DEC-16', 'BR-DEC-17', 'BR-DEC-24', 'BR-DEC-27',
      'BR-DE-1', 'BR-DE-2', 'BR-DE-5', 'BR-DE-6', 'BR-DE-7', 'BR-DE-15', 'BR-DE-18', 'BR-DE-23-a', 'BR-DE-30', 'BR-DE-31',
    ];
    expect(required.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('every category has the full -01 … -10 block (except -09 for S/AF/AG, which BR-CO-17 covers)', () => {
    for (const p of ['S', 'Z', 'E', 'AE', 'IC', 'G', 'O', 'AF', 'AG']) {
      for (let n = 1; n <= 10; n++) {
        if (n === 9 && ['S', 'AF', 'AG'].includes(p)) continue;
        expect(ids.has(`BR-${p}-${String(n).padStart(2, '0')}`), `BR-${p}-${String(n).padStart(2, '0')}`).toBe(true);
      }
    }
  });

  it('EN 16931 rules are errors; XRechnung rules only apply in profile xrechnung', () => {
    for (const r of RULES) {
      if (r.source === 'EN16931') expect(r.severity, r.id).toBe('error');
      if (r.id.startsWith('BR-DE-') || r.id.startsWith('IF-XR-')) expect(r.profiles, r.id).toEqual(['xrechnung']);
    }
  });
});
