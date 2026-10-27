/**
 * Vitest global setup: makes sure the Factur-X Schematron rule sets are installed before any test
 * runs. They are not part of the repository (licensing, see NOTICE); the first run downloads and
 * compiles them into `schematron/facturx/` (about a minute, needs network), later runs reuse them.
 * In CI the directory is cached.
 */
import { facturxDir, isRuleSetAvailable, FACTURX_RULE_SETS } from '../src/xml-validate/artifacts.js';
import { setupFacturx } from '../src/xml-validate/facturx-setup.js';

export default async function setup(): Promise<void> {
  if (FACTURX_RULE_SETS.every((rs) => isRuleSetAvailable(rs))) return;
  process.stdout.write(`Factur-X rule sets missing in ${facturxDir()}; installing (one-time download and compile)...\n`);
  await setupFacturx({ log: (m) => process.stdout.write(`${m}\n`) });
}
