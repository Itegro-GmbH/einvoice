/**
 * Runtime measurement (only with BENCH=1): generate() warm: stages render/pdfa, total with/without Schematron, RSS, PDF size;
 * for fixture 01 (classic) and the 60-line invoice. `BENCH=1 npx vitest run test/bench`.
 */
import { describe, expect, it } from 'vitest';
import { generate, type GenerateOptions } from '../../src/index.js';
import { loadFixture, longInvoice } from '../helpers/fixtures.js';

const BENCH = process.env['BENCH'] === '1';

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}
const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(0)} MB`;

describe.skipIf(!BENCH)('Runtime of generate()', () => {
  it('measures and prints', async () => {
    const out: string[] = [];
    const cases: { name: string; input: unknown; options: GenerateOptions }[] = [
      { name: 'Fixture 01 classic', input: loadFixture('01-simple-19-en16931'), options: {} },
      { name: 'Fixture 01 modern', input: loadFixture('01-simple-19-en16931'), options: { template: { template: 'modern' } } },
      { name: '60 Positionen classic', input: longInvoice(60), options: {} },
    ];
    const t0 = performance.now();
    const first = await generate(cases[0]!.input, {});
    out.push(`generate first call (fonts + Schematron cold): ${(performance.now() - t0).toFixed(0)} ms, ${String(first.meta.pdfBytes)} bytes`);
    for (const c of cases) {
      for (const skip of [true, false]) {
        for (let i = 0; i < 3; i++) await generate(c.input, { ...c.options, skipXmlValidation: skip });
        const total: number[] = [];
        const stages = { validate: [] as number[], serialize: [] as number[], schematron: [] as number[], render: [] as number[], pdfa: [] as number[] };
        let last = first;
        for (let i = 0; i < 15; i++) {
          const t = performance.now();
          last = await generate(c.input, { ...c.options, skipXmlValidation: skip });
          total.push(performance.now() - t);
          for (const k of Object.keys(stages) as (keyof typeof stages)[]) stages[k].push(last.meta.durationMs[k]);
        }
        out.push(
          `${c.name} ${skip ? 'without' : 'with'} Schematron: total median ${median(total).toFixed(1)} ms (min ${Math.min(...total).toFixed(1)}, max ${Math.max(...total).toFixed(1)}); ` +
            `validate ${median(stages.validate).toFixed(1)} · serialize ${median(stages.serialize).toFixed(1)} · schematron ${median(stages.schematron).toFixed(1)} · ` +
            `render ${median(stages.render).toFixed(1)} · pdfa ${median(stages.pdfa).toFixed(1)} ms; pages ${String(last.meta.pages)}, PDF ${String(last.meta.pdfBytes)} bytes, XML ${String(last.meta.xmlBytes)} bytes`,
        );
      }
    }
    const m = process.memoryUsage();
    out.push(`RSS at the end: ${mb(m.rss)}, Heap ${mb(m.heapUsed)}`);
    process.stdout.write(`\n${out.join('\n')}\n`);
    expect(out.length).toBeGreaterThan(0);
  }, 180_000);
});
