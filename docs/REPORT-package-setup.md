# Report: turning the library into the standalone package @itegro/einvoice

Package `@itegro/einvoice` 0.1.0, license Apache-2.0, branch `main`, nothing published, no tag, nothing pushed.
Direction changes received during the work (all incorporated): GitHub Packages replaced by npmjs.com, license
Apache-2.0 instead of proprietary, license audit of third-party content, release flow with npm token or OIDC,
no promotion of the discontinued RechnuFix API, dry-run only.

## Decisions and reasons

| Topic | Decision | Reason |
|---|---|---|
| Package manager | **npm** (`package-lock.json`, `npm ci`) | The artifact is consumed with npm, `npm pack`/`npm publish` are the pipeline, `actions/setup-node` caches npm without extra setup, and the smoke test installs with npm, so the lockfile and the consumer use the same resolver. pnpm's strictness against undeclared dependencies is replaced by the smoke test, which installs the tarball into an empty directory. |
| Build | Plain **`tsc`** (`tsconfig.build.json`, module/moduleResolution `NodeNext`, `rootDir src` to `dist`, with `.d.ts`) | No bundler, so nothing is bundled and every dependency stays external. The source used extensionless relative imports (bundler resolution), which Node ESM cannot load; all 87 files were rewritten to `.js` specifiers. `decimal.js` needed a named import under NodeNext. |
| `exports` | `.` to `./dist/index.js` with `types`, plus `./package.json`; `main`/`types` set too | Built files only. ESM only (`type: module`). |
| Clean builds | `scripts/clean-dist.mjs` runs before `tsc`; `prepare` runs the build (on install from Git, on `npm pack`, on `npm publish`, on `npm ci`) | A stale `dist/` cannot be published. `prepublishOnly` runs typecheck, lint and tests. |
| Peer dependencies | `react` `^18.2.0 \|\| ^19.0.0` (peer, and exact 19.3.0 as dev dependency); `@types/react` optional peer | The code imports `react` at runtime (`import React` in `render/templates/shared.ts`) and `@react-pdf/renderer` has react as a peer, so a second React copy would break rendering. The public `.d.ts` references `ReactElement`. Smoke-tested with React 18.3.1 and 19. |
| Other dependencies | `@react-pdf/renderer ^4.9.0`, `pdf-lib ^1.17.1`, `decimal.js ^10.6.0`, `zod ^4.6.5` as regular dependencies with caret ranges; `saxon-js ~2.7.0` | The exact pins of the origin repo would force duplicate installs in consumers. `saxon-js` is tilde-pinned because the compiled rule sets and two workarounds target 2.7. `zod` stays a regular dependency: the exported schemas are Zod 4 schemas, and a peer range would make npm fail for consumers on Zod 3 (they get a nested copy instead). `decimal.js` is used through an own cloned constructor, so global configuration of other copies cannot influence rounding. |
| `engines` | `node >=20` | Measured, not guessed: the smoke test (install, generate, Schematron, PDF/A markers) passes on Node 20.20, 22.23 and 24.22 in Linux containers and on Node 26.4 on macOS. Node 20 is end of life; the floor is documented as tested, not as supported by CI forever. Node 18 was not tried. |
| Path resolution | New `src/package-paths.ts` is the only place using `import.meta.url`; fonts, ICC profile and SEF files go through `packagePath()` | `src/` and `dist/` both sit one level below the package root, so the same code works in tests and when installed. No use of `process.cwd()`. Unit test chdirs to `/` and still finds all files. The smoke test also runs from an unrelated directory. |
| Contact | `author` Itegro GmbH, `support@itegro-gmbh.de` in `package.json`, README and NOTICE | As instructed. |

Rule IDs keep their `IF-` prefix (stable error codes); the rule `source` label `'InvoiceFix'` became `'einvoice'`
(public type change in `Rule.source`, fine at 0.1.0).

## Results of the checks (final tree)

```
npm run typecheck   tsc --noEmit -p tsconfig.json                         0 errors
npm run lint        eslint .                                              0 errors, 0 warnings
VERAPDF_REQUIRED=1 npm test
  veraPDF 1.30.2: 73 PDFs generated in 5647 ms, checked in 3190 ms (one CLI call)
  Test Files  32 passed | 2 skipped (34)
  Tests      538 passed | 3 skipped (541)
npm run build       tsc -p tsconfig.build.json                            dist/ with 124 files (.js + .d.ts), no test files
actionlint          (both workflows)                                      clean
```

The 3 skipped tests are the two benchmarks (`BENCH=1`) and the placeholder that exists only when veraPDF is missing.
The whole suite also passed in a Linux container (node:24-slim, arm64) without Java:
`Test Files 31 passed | 3 skipped (34), Tests 464 passed | 77 skipped (541)` (the 77 skipped are the veraPDF suite).

Removed because they only make sense in the origin repository: `test/vorlagen-previews.test.ts` (compared against
`public/vorlagen/` of the app) and `scripts/generate-previews.ts` (produced those files). Kept: `test/pdf-normalize.test.ts`
and its helper (PDF comparison helper used by other tests).

## Package size (`npm pack` / `npm publish --dry-run`, nothing published)

```
package: @itegro/einvoice@0.1.0
package size: 1.4 MB      (1405433 bytes)
unpacked size: 9.4 MB     (9369696 bytes)
total files: 143
LICENSE, NOTICE, README.md, package.json
assets/fonts/{DejaVuSans,DejaVuSans-Bold,PTSerif-Regular,PTSerif-Bold}.ttf + LICENSE-DejaVu.txt, PTSerif-OFL.txt, SOURCE.md
assets/icc/sRGB-v2-magic.icc + LICENSE-CC0.txt, SOURCE.md
licenses/EUPL-1.2.txt
schematron/en16931/EN16931-CII-validation.sef.json   5.0 MB
schematron/xrechnung/XRechnung-CII-validation.sef.json   1.8 MB
schematron/xrechnung/LICENSE-Apache-2.0.txt, schematron/SOURCE.md
dist/**   124 files (.js and .d.ts, incl. dist/cli/setup-facturx.js)
npm warn publish This command requires you to be logged in to https://registry.npmjs.org/ (dry-run)
+ @itegro/einvoice@0.1.0
```

The dry run needs no login. Unverified by it: registry-side checks (scope exists, permissions, 2FA policy, provenance).
Note: the task text expected about 1.9 MB of Schematron; the real compiled files are 29 MB uncompressed, and without the
Factur-X sets 6.8 MB. The tarball is small because JSON compresses well.

## What the smoke tests proved

`scripts/smoke/smoke.mjs` (plain JavaScript, 12 checks without and 11 with the Factur-X rule sets): all exports present;
for every profile (`basic`, `en16931`, `extended`, `xrechnung`) and every template a PDF is created, starts with
`%PDF-1.`, contains the PDF/A-3B XMP markers, the `GTS_PDFA1` OutputIntent and `factur-x.xml`; `extractXml` returns exactly
the XML that `generate` returned; `validateXml` reports no error; a logo is rendered; output is byte-identical on a second run;
structured `InvoiceError.violations`; everything runs after `process.chdir(os.tmpdir())`.

| Run | Result |
|---|---|
| macOS arm64, Node 26.4: install of the tarball into an empty directory (+ TypeScript consumer compiled against the installed `.d.ts` with `strict`, NodeNext) | `smoke[facturx=absent]: 12 checks passed` |
| same consumer after `einvoice-setup-facturx` (real download and compile) | `smoke[facturx=present]: 11 checks passed` |
| macOS: install from a URL (local HTTP server on an ephemeral loopback port, stand-in for the release asset URL) | `12 checks passed` |
| macOS: install as Git dependency `git+file://<clone>#semver:^0.1.0` (clone of the committed HEAD with a temporary tag in the clone; built through `prepare`, 12 s) | `12 checks passed` |
| Linux arm64, `node:24-slim` container (tarball as mount) | `12 checks passed`, then `11 checks passed` after the setup command (`node v24.22.1`) |
| Linux arm64, `node:22-slim` | same, `node v22.23.4` |
| Linux arm64, `node:20-slim` | same, `node v20.20.2` |
| macOS, React 18.3.1 in the consumer | `12 checks passed` |
| Next.js 16.4.3 standalone output, started from another directory | with `outputFileTracingIncludes`: HTTP 200 and a PDF; without: `ENOENT ... assets/fonts/DejaVuSans.ttf` (HTTP 500). Works with and without `serverExternalPackages` in this version, which is still recommended. |

Limits: Git-dependency mode uses a local clone because the tag is not pushed; the real `github:` shorthand and the GitHub release
URL cannot be tested before the first release. Linux x64 and Windows were not tested (CI runs x64 Linux). The Next.js check
used a throw-away app outside the repository and is not part of CI.

## Third-party content: license audit and consequences

| Content | License and evidence | Decision |
|---|---|---|
| DejaVu Sans, Sans Bold 2.37 | Bitstream Vera Fonts License (+ public domain changes, Arev glyphs); `LICENSE-DejaVu.txt` shipped; license permits distribution, including inside larger software, with notice | Shipped, listed in NOTICE |
| PT Serif Regular/Bold | SIL OFL 1.1, `PTSerif-OFL.txt` with ParaType copyright shipped; bundling and embedding allowed, files unmodified, not sold alone | Shipped, listed in NOTICE |
| sRGB-v2-magic.icc | CC0 1.0 per the upstream README (Compact-ICC-Profiles) | Shipped, listed in NOTICE |
| EN 16931 CII Schematron 1.3.16 (compiled to SEF) | EUPL 1.2 (upstream repo statement and file header); text in `licenses/EUPL-1.2.txt` | Shipped as compiled data; NOTICE states it is a modified (compiled) form, gives the upstream source and where the corresponding source (XSLT plus compile script) lives. Treated as a separate data file, not linked into the Apache code. EUPL has no Apache entry in its compatibility list, so this separation matters (see open points). |
| XRechnung Schematron 2.6.0 (KoSIT, compiled to SEF) | Apache-2.0 (GitHub license metadata); upstream license file shipped unchanged (it contains the CEN/DIN reproduction note); upstream has no NOTICE | Shipped, listed in NOTICE |
| **Factur-X / ZUGFeRD Schematron 1.09.2 (FNFE-MPE/FeRD)**: XSLT, code lists, XSD, and the 3 compiled SEF files | No license statement found; fnfe-mpe.org says "All Rights Reserved" and gates the originals behind a form; the Apache-2.0 mirror (mustangproject) cannot grant the publishers' rights | **Not shipped, not in the repository, purged from git history.** Replacement below. |
| Test instances from the XRechnung test suite (25 files) | Apache-2.0 (repository license), one file carries a BITMARCK Apache notice | Kept (repository only, not in the npm package), listed in NOTICE |
| Test instances from mustangproject (20 files) | Apache-2.0 repository license, no third-party notice in the remaining files | Kept, listed in NOTICE; residual risk below |
| mustangproject files with FeRD "Nutzungsrechte" header (4) and the FNFE examples UC10/UC11 | The FeRD text licenses use of the data format, it does not clearly permit redistributing the examples | **Removed** from tree and history, with the one derived input JSON and their corpus entries |
| `CII_example1.xml` (EN 16931 example) | EUPL 1.2 (file carries the notice) | Kept (repository only), listed in NOTICE |
| Golden fixtures, visual snapshots, logo fixture, `minimal-en16931.xml` | Written for the project in the origin repository; invented data | Covered by Apache-2.0 |

### Answers to the two questions from the orchestrator

1. **How does the package check Factur-X now?** The EN 16931 and XRechnung rule sets still ship. The Factur-X rule sets
   (BASIC, EN 16931, EXTENDED) are fetched on the user's machine: `npx einvoice-setup-facturx` (or
   `installFacturxRuleSets()` in code) downloads the stylesheets from a pinned commit of the public mirror, verifies the
   SHA-256 of all six files (they match the files that were committed before), applies the two documented patches (code list
   inlining, EXTENDED division workaround; both abort on an unexpected match count) and compiles with SaxonJS (`xslt3` from the
   local install or `npm exec xslt3@2.7.0`). It takes about 30 seconds, needs network, writes about 22 MB to
   `<package>/schematron/facturx/` or `EINVOICE_FACTURX_DIR`. Without the files nothing crashes: the XML is still checked
   against EN 16931, `warnings` gets `IF-WARN-100` (message plus the exact command as hint), `validateXml()` returns
   `skipped`, and `requireAllRuleSets: true` turns it into a `RuleSetUnavailableError`
   whose message names the command. The `xrechnung` profile is complete without it; the `extended` profile is not validated at all until installed.
   The test suite provisions the rule sets itself (vitest `globalSetup`), CI caches them, and the smoke test runs the whole
   cycle (absent, setup, present) on macOS and in the Linux containers. What this costs: one extra install step, 30 s once per environment,
   and a network dependency at setup time. Not automated on `npm install` on purpose (no downloads from install scripts).
2. **Does the same apply to the rest?** No. XRechnung and EN 16931 rules, fonts and the ICC profile stay, each with evidence and
   notices (table above). Of the test data only the files that carried FeRD/FNFE terms were removed; the XRechnung test suite and the
   other mustangproject files stay (they are not part of the npm package in any case).

## Release flow (`.github/workflows/`)

- `ci.yml` (push and pull request on `main`, also `workflow_call`): job `check` (Node 24, `npm ci`, Java 21 + cached veraPDF,
  cached Factur-X rule sets, typecheck, lint, tests with `VERAPDF_REQUIRED=1`, build, `npm pack`, `npm publish --dry-run` on the
  tarball, upload of the tarball); job `smoke` (matrix: host modes tarball/URL/Git, containers `node:24-slim`, `node:22-slim`,
  `node:20-slim`) using that tarball.
- `release.yml`: triggered **only** by tags `v*`. `guard` (tag equals package.json version, tagged commit is on `main`,
  CHANGELOG section exists) then `ci.yml`, then in parallel `github-release` (tarball attached as
  `itegro-einvoice-X.Y.Z.tgz`, notes from CHANGELOG, pre-release flag for `-` versions) and `publish-npm` (the same tarball,
  `--provenance --access public`, permissions `id-token: write`). Authentication: the repository secret `NPM_TOKEN` if it exists,
  otherwise OIDC trusted publishing; the file comments say to delete the secret once trusted publishing is configured. If npm
  answers "scope not found" the job writes an error annotation ("organization itegro missing, nothing published") and fails;
  there are also messages for "version already published" and for rejected authentication.
- Every action is an official `actions/*` action pinned to a commit SHA with the version in a comment (checkout v7.0.1,
  setup-node v7.1.0, cache v6.1.0, setup-java v6.1.0, upload-artifact v7.0.2, download-artifact v8.0.2). Only `actionlint` ran
  on the workflows; they have not run on GitHub, so inputs of these (recent) major versions are unverified.

## Open points for the user

1. **npm organization `itegro`** must exist before the release run can publish. Until then `publish-npm` fails with a clear message.
2. **Trusted publishing after the first release.** As far as I could establish from community sources (not from npm's own
   documentation text, which I could not retrieve), the package must exist on npm before a trusted publisher can be configured, so the first
   release uses `NPM_TOKEN`. Afterwards: configure the trusted publisher on npmjs.com (owner `Itegro-GmbH`, repository `einvoice`,
   workflow `release.yml`) and delete the secret. Needs npm CLI 11.5.1 or newer (the workflow upgrades it if needed).
3. **Factur-X rule sets.** Ask FNFE-MPE (bureau@fnfe-mpe.org) and FeRD whether the Schematron files may be redistributed; with a written yes they
   could ship again. Until then the setup step stays. Please also have a lawyer glance at this audit; I am not one.
4. **EUPL and Apache.** The EN 16931 rule sets are EUPL-1.2 and shipped as a separate compiled data file. If you want zero doubt,
   the alternative is to treat them like the Factur-X sets (download at setup time).
5. **Git history was rewritten** (68 commits, not pushed yet) to remove the Factur-X files and the FeRD-noticed test files from every
   revision; a backup bundle of the previous state is at `scratchpad/einvoice-pre-license-cleanup.bundle` (outside the repository, contains the removed files, do not publish).
   Older commits still carry German messages, the old name `@invoicefix/core` and RechnuFix wording, and the old SEF builds. If that history should not
   be public, publish a single fresh initial commit instead.
6. **Residual test-data risk:** the 20 mustangproject instances are covered only by that repository's blanket Apache-2.0; per-file origin is not documented upstream.
   They are not in the npm package; remove them if you want zero risk.
7. `saxon-js` has Saxonica's own license (no redistribution on sites whose main purpose is distribution); mentioned in README and NOTICE.
8. The PDF text is German only (templates and `i18n/de.ts`); documented. `showPaymentQr` is reserved and has no effect.
9. Newer npm versions print an "allow-scripts" notice for install scripts; the Git-dependency path relies on the `prepare` script and worked with
   npm 11.17 here, but a future npm default could require approval for it.
10. Untested: Windows, Linux x64 locally, Node 18, the real `github:` and release-URL installs, the workflows on GitHub.
