import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { packagePath } from './package-paths.js';
import { artifactPath, RULE_SETS } from './xml-validate/artifacts.js';

describe('package-paths', () => {
  it('resolves the package root from the module location, not from the working directory', () => {
    const pkg = JSON.parse(fs.readFileSync(packagePath('package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('@itegro/einvoice');
  });

  it('finds every file the package reads at runtime', () => {
    for (const f of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf', 'PTSerif-Regular.ttf', 'PTSerif-Bold.ttf']) {
      expect(fs.existsSync(packagePath('assets', 'fonts', f)), f).toBe(true);
    }
    expect(fs.existsSync(packagePath('assets', 'icc', 'sRGB-v2-magic.icc'))).toBe(true);
    for (const rs of RULE_SETS) expect(fs.existsSync(artifactPath(rs)), rs).toBe(true);
  });

  it('keeps working after the process changes its working directory', () => {
    const before = process.cwd();
    try {
      process.chdir('/');
      expect(fs.existsSync(artifactPath('EN16931'))).toBe(true);
      expect(fs.existsSync(packagePath('assets', 'icc', 'sRGB-v2-magic.icc'))).toBe(true);
    } finally {
      process.chdir(before);
    }
  });
});
