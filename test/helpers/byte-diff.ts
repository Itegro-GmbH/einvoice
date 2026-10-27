/**
 * Test helper: compare two byte sequences. On inequality, both files are written to a debug directory
 * (`EINVOICE_DEBUG_DIR`, otherwise `os.tmpdir()`) and the first differing position with ±200 bytes of
 * context (latin1, non-printable characters as `.`) is named in the error message, as evidence for determinism flakes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONTEXT = 200;

function printable(b: Uint8Array): string {
  return Buffer.from(b)
    .toString('latin1')
    .replace(/[^\x20-\x7e\n]/g, '.');
}

export function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** Describes the first difference readably; `undefined` if identical. */
export function describeDifference(a: Uint8Array, b: Uint8Array): string | undefined {
  const pos = firstDifference(a, b);
  if (pos < 0) return undefined;
  const from = Math.max(0, pos - CONTEXT);
  const to = pos + CONTEXT;
  return [
    `first difference at byte ${String(pos)} (lengths ${String(a.length)} / ${String(b.length)})`,
    `--- A [${String(from)}..${String(to)}] ---`,
    printable(a.subarray(from, to)),
    `--- B [${String(from)}..${String(to)}] ---`,
    printable(b.subarray(from, to)),
  ].join('\n');
}

/** Writes both PDFs to the debug directory and returns the paths. */
export function dumpPair(a: Uint8Array, b: Uint8Array, prefix: string): { dir: string; files: [string, string] } {
  const dir = process.env['EINVOICE_DEBUG_DIR'] ?? os.tmpdir();
  fs.mkdirSync(dir, { recursive: true });
  const fa = path.join(dir, `${prefix}-a.pdf`);
  const fb = path.join(dir, `${prefix}-b.pdf`);
  fs.writeFileSync(fa, a);
  fs.writeFileSync(fb, b);
  return { dir, files: [fa, fb] };
}

/** Throws with byte diff evidence if `a` and `b` are not byte-identical. */
export function expectSameBytes(a: Uint8Array, b: Uint8Array, prefix = 'pdf'): void {
  const desc = describeDifference(a, b);
  if (desc === undefined) return;
  const { files } = dumpPair(a, b, prefix);
  throw new Error(`${prefix}: not byte-identical; files: ${files[0]}, ${files[1]}\n${desc}`);
}
