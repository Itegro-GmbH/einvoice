/**
 * The single place that knows where the files shipped inside the package live.
 *
 * Fonts, the ICC profile and the precompiled Schematron rule sets are read from disk at runtime.
 * Their location is derived from this module's own URL (`import.meta.url`), never from the
 * process working directory and never from a repository layout: the same code runs from `src/`
 * (tests) and from `dist/` (installed package), because both sit exactly one level below the
 * package root next to `assets/` and `schematron/`.
 *
 * If a bundler or a serverless platform has to be told about these files (file tracing,
 * `includeFiles`), this directory is what has to be copied along; see the README section on
 * bundlers and serverless platforms.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the package root (the directory that contains `package.json`, `assets/` and `schematron/`). */
export const PACKAGE_ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute path of a file or directory below the package root. */
export function packagePath(...segments: string[]): string {
  return path.join(PACKAGE_ROOT, ...segments);
}
