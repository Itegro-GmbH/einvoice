/**
 * veraPDF CLI (tools/verapdf, installed by scripts/setup-verapdf.sh) for tests: one call for many
 * files (the JVM start of ~1.5 s happens only once), one result per file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const VERAPDF_BIN = path.join(REPO_ROOT, 'tools', 'verapdf', 'verapdf');

export function veraPdfAvailable(): boolean {
  return fs.existsSync(VERAPDF_BIN);
}

export const VERAPDF_SKIP_MESSAGE = `veraPDF is missing (${VERAPDF_BIN}); run "npm run setup:verapdf". Test skipped`;

export interface VeraPdfFailure {
  rule: string;
  failedChecks: number;
  description: string;
  contexts: string[];
}

export interface VeraPdfResult {
  compliant: boolean;
  profile: string;
  passedRules: number;
  passedChecks: number;
  failed: VeraPdfFailure[];
}

interface Report {
  report: {
    buildInformation?: { releaseDetails?: { version?: string }[] };
    jobs: {
      itemDetails: { name: string };
      taskException?: unknown;
      validationResult?: {
        compliant: boolean;
        profileName: string;
        details: {
          passedRules: number;
          passedChecks: number;
          ruleSummaries?: {
            specification: string;
            clause: string;
            testNumber: number;
            status: string;
            failedChecks: number;
            description: string;
            checks?: { context: string; errorMessage?: string }[];
          }[];
        };
      }[];
    }[];
  };
}

/** Validates all files against flavour 3b in ONE CLI call; the map key is the absolute file path. */
export function validatePdfA3b(files: readonly string[]): { results: Map<string, VeraPdfResult>; version: string | undefined; ms: number } {
  const t0 = performance.now();
  const r = spawnSync(VERAPDF_BIN, ['-f', '3b', '--format', 'json', ...files], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const ms = performance.now() - t0;
  if (r.stdout === '' || r.stdout === null) throw new Error(`veraPDF produced no output (exit ${String(r.status)}): ${r.stderr}`);
  const report = JSON.parse(r.stdout) as Report;
  const results = new Map<string, VeraPdfResult>();
  for (const job of report.report.jobs) {
    if (job.taskException !== undefined) throw new Error(`veraPDF exception for ${job.itemDetails.name}: ${JSON.stringify(job.taskException)}`);
    const vr = job.validationResult?.[0];
    if (vr === undefined) throw new Error(`veraPDF returned no validationResult for ${job.itemDetails.name}`);
    results.set(path.resolve(job.itemDetails.name), {
      compliant: vr.compliant,
      profile: vr.profileName,
      passedRules: vr.details.passedRules,
      passedChecks: vr.details.passedChecks,
      failed: (vr.details.ruleSummaries ?? [])
        .filter((s) => s.status !== 'passed')
        .map((s) => ({
          rule: `${s.specification} ${s.clause}-${String(s.testNumber)}`,
          failedChecks: s.failedChecks,
          description: s.description,
          contexts: (s.checks ?? []).slice(0, 3).map((c) => `${c.context}${c.errorMessage === undefined ? '' : ` – ${c.errorMessage}`}`),
        })),
    });
  }
  return { results, version: report.report.buildInformation?.releaseDetails?.[0]?.version, ms };
}
