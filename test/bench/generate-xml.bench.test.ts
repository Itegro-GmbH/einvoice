/**
 * Runtime measurement (only with BENCH=1): generateXml warm with/without Schematron, SEF load time cold, RSS.
 * `BENCH=1 npx vitest run test/bench`: results on stdout, no assertions except plausibility.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateXml, RULE_SETS, type InvoiceInput } from '../../src/index.js';
import { loadSef } from '../../src/xml-validate/index.js';
import { FIXTURE_DIR } from '../golden/fixtures.js';

const BENCH = process.env['BENCH'] === '1';

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

describe.skipIf(!BENCH)('Runtime of generateXml (fixture 01)', () => {
  it('measures and prints', async () => {
    const input = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, '01-simple-19-en16931.json'), 'utf8')) as InvoiceInput;
    const out: string[] = [];

    // SEF cold (first call in the process): read file + JSON.parse
    const rss0 = process.memoryUsage().rss;
    for (const rs of RULE_SETS) {
      const t0 = performance.now();
      loadSef(rs);
      out.push(`SEF cold ${rs}: ${(performance.now() - t0).toFixed(0)} ms`);
    }
    out.push(`RSS after SEF load: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB (before ${(rss0 / 1024 / 1024).toFixed(0)} MB)`);

    const t1 = performance.now();
    await generateXml(input);
    out.push(`generateXml first call (incl. Schematron cold): ${(performance.now() - t1).toFixed(0)} ms`);

    for (const skip of [true, false]) {
      for (let i = 0; i < 3; i++) await generateXml(input, { skipXmlValidation: skip });
      const times: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t = performance.now();
        await generateXml(input, { skipXmlValidation: skip });
        times.push(performance.now() - t);
      }
      out.push(`generateXml warm ${skip ? 'without' : 'with'} Schematron: median ${median(times).toFixed(1)} ms, min ${Math.min(...times).toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms (20 runs)`);
    }
    out.push(`RSS at the end: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB, Heap ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)} MB`);
    process.stdout.write(`\n${out.join('\n')}\n`);
    expect(out.length).toBeGreaterThan(0);
  }, 120_000);
});
