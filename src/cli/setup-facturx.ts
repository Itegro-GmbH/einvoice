#!/usr/bin/env node
/**
 * `npx einvoice-setup-facturx [--dir <path>] [--force]`
 *
 * Downloads and compiles the Factur-X / ZUGFeRD Schematron rule sets that this package does not
 * ship (see NOTICE and the README section "Factur-X rule sets"). Needs network access and Node.
 */
import { facturxDir } from '../xml-validate/artifacts.js';
import { setupFacturx } from '../xml-validate/facturx-setup.js';

const USAGE = `Usage: einvoice-setup-facturx [--dir <path>] [--force]

Downloads the Factur-X / ZUGFeRD Schematron rule sets (BASIC, EN 16931, EXTENDED) from a pinned
upstream commit, verifies their SHA-256 checksums and compiles them for SaxonJS.

  --dir <path>  Target directory. Default: $EINVOICE_FACTURX_DIR, else <package>/schematron/facturx
  --force       Rebuild files that already exist
  -h, --help    Show this help
`;

async function main(argv: string[]): Promise<number> {
  let dir: string | undefined;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      return 0;
    }
    if (a === '--force') force = true;
    else if (a === '--dir') {
      dir = argv[++i];
      if (dir === undefined) {
        process.stderr.write('--dir needs a value\n');
        return 2;
      }
    } else {
      process.stderr.write(`Unknown argument: ${String(a)}\n\n${USAGE}`);
      return 2;
    }
  }
  try {
    const files = await setupFacturx({ ...(dir !== undefined ? { dir } : {}), force, log: (m) => process.stdout.write(`${m}\n`) });
    process.stdout.write(`Done. ${String(files.length)} rule sets available in ${dir ?? facturxDir()}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`einvoice-setup-facturx failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
