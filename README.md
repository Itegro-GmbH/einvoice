# @itegro/einvoice

Generate and validate EN 16931 e-invoices in Node.js: **ZUGFeRD / Factur-X** (PDF/A-3B with embedded XML) and **XRechnung** (CII XML). One call turns structured invoice data into a ready-to-send PDF and the matching XML.

```
InvoiceInput -> normalize -> calculate -> validate -> serializeCii -> validateXml (Schematron, SaxonJS)  -> xml
                                                          \-> toViewModel -> renderInvoice (react-pdf) -> toPdfA3 (pdf-lib) -> pdf
```

- Cent-exact calculation (integer/decimal arithmetic, commercial rounding), every sum is computed by the library itself, never trusted from the caller.
- More than 100 validation rules reported in terms of your input (`lines[2].vat.rate`), not as XPath.
- The generated XML is checked against the official Schematron rule sets (EN 16931, XRechnung 3.0.2, Factur-X 1.09.2) with SaxonJS, in-process.
- PDF/A-3B output (verified with veraPDF in the test suite), four templates, optional logo.
- Reproducible: the same input and options give a byte-identical PDF.
- Runs in plain Node.js: no Chromium, no Ghostscript, no JVM, no network access at runtime.

Originally developed for RechnuFix. It is now maintained as a standalone open source library by Itegro GmbH.

## Disclaimer

**This software is not tax or legal advice and gives no guarantee that an invoice is accepted by a tax authority, a recipient or a validation service.** The library implements published standards and checks its output against the official validation rules, but conformance in an individual case is not assured: standards, rule sets and legal requirements change, input data can be wrong in ways no rule detects, and national requirements (for example German VAT law, the GoBD, Peppol or recipient-specific rules) go beyond what is checked here. **You use it at your own risk and are responsible for checking the invoices you create** (content, amounts, VAT treatment, mandatory fields) and for meeting your legal obligations. The software is provided "as is", without warranty of any kind; see sections 7 and 8 of the [Apache License 2.0](LICENSE).

## Contents

- [Installation](#installation) (and [which way should I pick?](#which-way-should-i-pick))
- [Factur-X rule sets](#factur-x-rule-sets)
- [Quick start](#quick-start)
- [API](#api)
- [Input model](#input-model)
- [Templates and options](#templates-and-options)
- [XRechnung](#xrechnung)
- [Errors and warnings](#errors-and-warnings)
- [Reproducibility](#reproducibility)
- [Bundlers and serverless platforms](#bundlers-and-serverless-platforms)
- [Development](#development) | [Contributing](#contributing) | [License](#license) | [Support](#support)

## Installation

Requirements: Node.js 20 or newer (tested on 20, 22 and 24), and React 18 or 19 as a peer dependency (react-pdf needs it; it is installed automatically by npm 7+). The package is ESM only and ships TypeScript declarations.

### 1. From npm (recommended, no login)

```sh
npm install @itegro/einvoice
```

TypeScript users who do not use React elsewhere also need `@types/react` (an optional peer dependency, only for the template types).

### 2. As a Git dependency on the public repository (no login, no registry)

```jsonc
// package.json
{ "dependencies": { "@itegro/einvoice": "github:Itegro-GmbH/einvoice#semver:^0.1.0" } }
```

npm resolves the newest matching `v0.x.y` tag, clones the repository and builds the package on your machine (the `prepare` script runs `tsc`; it needs no network access of its own and no extra tools). The downside: installation takes longer (the repository's dev dependencies are installed to build it, typically 10 to 60 seconds) and needs a complete Node environment with a writable temp directory. Your lockfile pins the exact commit.

### 3. From the release file (no login, no registry, no build)

Every release has the exact tarball from `npm pack` attached:

```jsonc
// package.json
{ "dependencies": { "@itegro/einvoice": "https://github.com/Itegro-GmbH/einvoice/releases/download/v0.1.0/itegro-einvoice-0.1.0.tgz" } }
```

Nothing is built at install time, so this suits slim container images. Your lockfile records the file's integrity hash. Updates are manual: change the URL to the new version.

### Which way should I pick?

| Situation | Recommended | Why |
|---|---|---|
| Local development | npm registry (1) | Normal semver updates, fastest install |
| GitHub Actions (build, test, deploy) | npm registry (1) | Cached by `actions/setup-node` (`cache: npm`); no token needed |
| Vercel with a prebuilt deployment (`vercel build` / `vercel deploy --prebuilt` after installing in CI) | npm registry (1), installed in the CI job | Vercel installs nothing; the traced files come from the CI `node_modules` (see [Next.js on Vercel](#nextjs-and-vercel)) |
| Slim container image, offline or pinned builds | Release file (3) | No build step in the image, an immutable file with a recorded hash |
| You want to test an unreleased commit or branch | Git dependency (2), `github:Itegro-GmbH/einvoice#<branch or sha>` | Builds from source |

## Factur-X rule sets

The package ships the Schematron rule sets for **EN 16931** and **XRechnung**. The rule sets for the Factur-X / ZUGFeRD profiles **BASIC, EN 16931 and EXTENDED** are published by FNFE-MPE and FeRD without a license that allows redistribution, so they are **not** part of this package. Install them once with:

```sh
npx einvoice-setup-facturx
```

The command downloads the original stylesheets from a pinned commit of a public mirror, verifies their SHA-256 checksums, applies two documented patches and compiles them with SaxonJS into `schematron/facturx/` inside the installed package (about 30 seconds, needs network access and writes about 22 MB). Options: `--dir <path>` (or the environment variable `EINVOICE_FACTURX_DIR`) to choose another directory, `--force` to rebuild. From code: `await installFacturxRuleSets({ dir })`.

### Set it up automatically

If you use the Factur-X profiles, make the step part of your own install instead of
remembering it. One line in the consuming project's `package.json`:

```json
{
  "scripts": {
    "postinstall": "einvoice-setup-facturx"
  }
}
```

From then on every `npm install` and `npm ci` sets the rule sets up, locally and in CI.
The trade-off is that installing now needs network access: in an offline or sandboxed
install this fails. Pick a directory outside `node_modules` if you reinstall often, so
the files survive and can be cached:

```json
{
  "scripts": {
    "postinstall": "einvoice-setup-facturx --dir .facturx"
  }
}
```

Then set `EINVOICE_FACTURX_DIR=.facturx` in the environment your application runs in.

For CI and images, run it in the build step after `npm ci` (and cache `node_modules/@itegro/einvoice/schematron/facturx`). It is not run automatically on install, because a package should not download and execute things behind your back.

If the rule sets are missing, nothing breaks: the XML is still validated against EN 16931 (and the XRechnung profile is complete, it does not use the Factur-X rules). Profiles `basic`, `en16931` and `extended` add the warning `IF-WARN-100` ("The Schematron rule set FACTURX-... is not installed") to `warnings`; the `extended` profile is checked by the Factur-X rules only, so it is not checked at all until they are installed. Pass `requireAllRuleSets: true` to `generate()`, `generateXml()` or `validateXml()` to throw a `RuleSetUnavailableError` instead. `validateXml()` reports what it skipped in `result.skipped`.

## Quick start

```js
import fs from 'node:fs/promises';
import { generate, InvoiceError } from '@itegro/einvoice';

const input = {
  profile: 'en16931', // 'basic' | 'en16931' | 'extended' | 'xrechnung' (default 'en16931')
  number: 'RE-2026-00001',
  issueDate: '2026-09-12',
  dueDate: '2026-09-26',
  deliveryDate: '2026-09-10',
  buyerReference: 'PO-4711',
  seller: {
    name: 'Example Works GmbH',
    address: { street: 'Industriestrasse 12', city: 'Stuttgart', postalCode: '70565', country: 'DE' },
    vatId: 'DE123456789',
    taxNumber: '93815/08152',
    legalRegistration: { id: 'HRB 12345', scheme: '0002' },
    contact: { name: 'Erika Example', phone: '+49 711 123456-0', email: 'billing@example-works.example' },
    electronicAddress: { scheme: 'EM', value: 'billing@example-works.example' },
  },
  buyer: {
    name: 'Sample & Sons KG',
    address: { street: 'Hauptstrasse 1', city: 'Berlin', postalCode: '10115', country: 'DE' },
    vatId: 'DE987654321',
    orderReference: 'PO-2026-77',
  },
  payment: { means: 'transfer', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', terms: 'Payable within 14 days without deduction.' },
  lines: [
    { name: 'Consulting', quantity: 12, unit: 'hour', unitPrice: '95.00', vat: { category: 'S', rate: 19 } },
    { name: 'Integration package', quantity: 1, unit: 'C62', unitPrice: 2490, vat: { category: 'S', rate: 19 } },
  ],
};

try {
  const { xml, pdf, warnings, meta } = await generate(input, {
    template: { template: 'modern', accentColor: '#1f4e79' },
  });
  await fs.writeFile('RE-2026-00001.pdf', pdf); // PDF/A-3B with the XML embedded as factur-x.xml
  await fs.writeFile('factur-x.xml', xml);
  console.log(meta.pages, 'pages,', meta.pdfBytes, 'bytes,', warnings.length, 'warnings');
} catch (e) {
  if (e instanceof InvoiceError) console.error(e.violations); // see "Errors and warnings"
  else throw e;
}
```

`generate()` resolves to `{ xml: string, pdf: Uint8Array, warnings: Warning[], profile, meta }`. `meta` holds `{ pages, xmlBytes, pdfBytes, durationMs: { validate, serialize, schematron, render, pdfa } }`.

## API

All functions are exported from the package root (`import { ... } from '@itegro/einvoice'`).

| Function | Purpose |
|---|---|
| `generate(input, options?)` | Input to `{ xml, pdf, warnings, profile, meta }`. Runs Schematron on the XML; veraPDF is not run (it is a Java tool used in the tests). |
| `generateXml(input, options?)` | Input to `{ xml, warnings, profile }`, no PDF. |
| `validateXml(xml, profile, options?)` | Schematron validation of any CII XML: `{ errors, warnings, skipped }` of `SvrlFinding` (`rule`, `flag`, `location`, `text`, `source`). Throws on malformed XML. |
| `extractXml(pdf)` | Reads the embedded XML (`factur-x.xml`, `zugferd-invoice.xml`, `xrechnung.xml`) from a PDF: `{ xml, filename } \| null`. |
| `normalize(input)` / `calculate(normalized)` / `validate(calculated)` / `assertValid(calculated)` | The pipeline stages. `validate` returns `{ violations, warnings }`; `assertValid` throws `InvoiceError`. |
| `serializeCii(calculated)` | `CalculatedInvoice` to CII D16B XML (deterministic). |
| `toViewModel(calculated, options?)` / `renderInvoice(viewModel, { template, watermark? })` / `toPdfA3(basePdf, options)` | Rendering stages, for example for a preview without PDF/A. |
| `parseInvoiceInput(input)`, `InvoiceInputSchema`, `TemplateOptionsSchema`, `parseTemplateOptions` | Zod 4 schemas for input and template options. |
| `installFacturxRuleSets(options?)` | Programmatic form of `npx einvoice-setup-facturx`. |
| `RULES`, `findRule(id)` | Catalog of validation rules with descriptions. |
| `Decimal`, `D`, `round2`, `toFixed2`, `fromInput` | The decimal helpers used for money. |
| `preloadAll()` | Loads all installed rule sets into memory (for a serverless warm start). |

Options of `generate(input, options)`:

```ts
interface GenerateOptions {
  template?: TemplateOptionsInput;   // see "Templates and options"
  watermark?: string;                // diagonal text on every page, e.g. 'TEST'
  skipXmlValidation?: boolean;       // skip Schematron (default false)
  requireAllRuleSets?: boolean;      // throw if a Factur-X rule set is missing (default false)
  createdAt?: Date;                  // PDF creation time; default: issueDate 00:00:00 UTC (reproducible)
}
```

Signatures of the main functions:

```ts
generate(input: unknown, options?: GenerateOptions): Promise<GenerateResult>
generateXml(input: unknown, options?: GenerateXmlOptions): Promise<GenerateXmlResult>
validateXml(xml: string, profile: Profile, options?: { requireAllRuleSets?: boolean }): Promise<XmlValidationResult>
extractXml(pdf: Uint8Array): Promise<{ xml: string; filename: string } | null>
```

Example: validate an XML you received, and read the XML out of a PDF:

```js
import fs from 'node:fs/promises';
import { extractXml, validateXml } from '@itegro/einvoice';

const embedded = await extractXml(await fs.readFile('incoming.pdf'));
if (embedded) {
  const { errors, warnings, skipped } = await validateXml(embedded.xml, 'en16931');
  console.log(errors.length, 'errors,', warnings.length, 'warnings, skipped:', skipped);
}
```

## Input model

`InvoiceInput` is plain JSON, phrased in business terms. The mapping to EN 16931 code lists happens in `normalize()`. Unknown keys are rejected. Main fields:

| Field | Notes |
|---|---|
| `profile` | `basic`, `en16931` (default), `extended`, `xrechnung` |
| `number`, `issueDate` (`YYYY-MM-DD`), `dueDate`, `currency` (default `EUR`) | |
| `type` | `invoice` / `380` (default), `credit-note` / `381`, `correction` / `384` (then `precedingInvoices` is expected) |
| `deliveryDate` or `delivery`, `periodStart` / `periodEnd` | Without a delivery date or period you get warning `IF-WARN-002` (German VAT law, Section 14 UStG) |
| `seller`, `buyer` | `name`, `address`, `vatId`, `taxNumber` (seller), `legalRegistration`, `contact`, `electronicAddress`, `orderReference` (buyer) |
| `payment` | `means`: `transfer`, `sepa-direct-debit`, `card`, `cash` or a UNTDID 4461 code; `iban`, `bic`, `accountHolder`, `terms`, `reference`, direct debit fields |
| `lines[]` | `name`, `quantity`, `unit` (alias like `hour`, `piece`, or a UN/ECE Rec. 20 code like `HUR`), `unitPrice` (up to 4 decimals), `vat: { category, rate }`, line `allowances` / `charges` |
| `allowances`, `charges` | Document level, each with a `vat` category |
| `prepaidAmount`, `roundingAmount`, `notes`, `buyerReference` | |

Amounts and quantities may be numbers or strings (`'95.00'`); use strings for exact decimals. VAT categories: `S`, `Z`, `E`, `AE` (reverse charge), `K` (intra-community), `G`, `O`, `L`, `M`. The full types are in `dist/model/input.d.ts` (`InvoiceInput`, `LineInput`, `PartyInput`, ...).

## Templates and options

```ts
{
  template: 'classic' | 'modern' | 'minimal' | 'elegant',  // default 'classic'
  accentColor: '#rrggbb',                                   // default '#1f4e79'
  logo?: { data: Uint8Array | string /* base64 */, mime: 'image/png' | 'image/jpeg' },  // up to 2 MB; no SVG, no CMYK JPEG
  footerText?: string,                                      // up to 500 characters, below the master data
  pageSize: 'A4',
  showPaymentQr: false,                                     // reserved, currently without effect
}
```

| Template | Look |
|---|---|
| `classic` | Standard business letter per DIN 5008 in black and gray; the accent color only on the table header line |
| `modern` | Accent color as header bar and table header, compact footer |
| `minimal` | Generous white space, hairlines only, accent color only on the amount due |
| `elegant` | Serif typeface (PT Serif) for headings and totals, a fine double line |

`TEMPLATE_NAMES` and `TEMPLATE_DESCRIPTIONS` list them in code. Unknown option keys are rejected (`IF-TEMPLATE-001`, path `template.<field>`); a bad logo gives `IF-TEMPLATE-002`.

**Language of the PDF:** the text printed on the invoice (labels, payment terms heading, VAT notes) is German and cannot be changed in this version. The API, error messages, warnings and documentation are English. Invoice content (names, line texts, notes) is whatever you pass in.

## XRechnung

Set `profile: 'xrechnung'` for XRechnung 3.0.2 (CII). The specification identifier (BT-24) is `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`. In practice you need:

- **Leitweg-ID** (the routing ID of German public-sector recipients) in `buyerReference` (BT-10), for example `04011000-12345-03`. It is mandatory for XRechnung (BR-DE-15).
- **Electronic addresses** (BT-34 seller, BT-49 buyer) in `electronicAddress: { scheme, value }`. Schemes come from the EAS code list: `EM` (email), `0204` (Leitweg-ID), `9930` (German VAT identifier), and so on.
- A **seller contact** (name, phone, email) and the payment details (BR-DE rules).

The embedded XML file is named `factur-x.xml` in all profiles. Validation uses the EN 16931 and the KoSIT XRechnung rule sets. If your recipient runs its own validator (a portal, the KoSIT validator), run your sample invoices through it once before going live.

## Errors and warnings

Input problems are reported **before** any XML is built, in your terms, as an `InvoiceError` with a `violations` array:

```js
import { generate, InvoiceError } from '@itegro/einvoice';

try {
  await generate({ ...input, buyer: { ...input.buyer, address: { street: '1 High Street', city: 'Dublin', postalCode: 'D02', country: 'IE' } },
                   lines: [{ name: 'Consulting', quantity: 10, unit: 'hour', unitPrice: '120.00', vat: { category: 'AE' } }] });
} catch (e) {
  if (e instanceof InvoiceError) console.log(e.violations);
}
// [
//   {
//     rule: 'BR-AE-02',
//     path: 'buyer.vatId',
//     businessTerm: 'BT-48',
//     message: 'For reverse charge, the VAT identifier of the recipient is required.',
//     hint: 'Provide buyer.vatId (e.g. "ATU12345678"); alternatively buyer.legalRegistration.id (legal registration number, BT-47).'
//   }
// ]
```

Each violation has `rule`, `path` (a path in your input, never an XPath), `message` with concrete values, optionally `businessTerm` and `hint`. Rule namespaces: `BR-*` (EN 16931), `BR-DE-*` (XRechnung), `IF-SCHEMA-*` (input structure), `IF-NORM-*` (normalization), `IF-PROFILE-*`, `IF-PAY-*`, `IF-TEMPLATE-*`. A Schematron error on the generated XML should never happen; if it does it is thrown with the Schematron rule ID and the hint "Internal serialization error, please report this".

**Warnings** (`warnings: Warning[]`, `{ code, path, businessTerm?, message, hint?, xpath? }`) never prevent generation: `IF-WARN-*` for questionable content (for example a missing delivery date, `IF-WARN-002`), `IF-WARN-100` for a missing Factur-X rule set, and `SCH-<rule id>` for Schematron warnings. `path` is always an input path or `''` for the invoice as a whole.

## Reproducibility

`generate()` is deterministic: the PDF creation time defaults to `issueDate` 00:00:00 UTC (override with `createdAt`), the PDF trailer ID is a hash over the XML, the template options and the template version, and no random values or current time enter the output. The same input, options and package version produce a byte-identical PDF, which supports archiving requirements. The exact bytes also depend on the versions of `@react-pdf/renderer`, `pdf-lib` and on the zlib build of the Node.js binary (the compressed streams can differ between a macOS and a Linux Node build while the decompressed content is identical).

## Bundlers and serverless platforms

At runtime the library reads three groups of files from its own package directory: fonts (`assets/fonts`), the ICC color profile (`assets/icc`) and the compiled Schematron rule sets (`schematron/**/*.sef.json`, about 7 MB, plus about 22 MB if you installed the Factur-X rule sets). The location is derived from the module's own URL (`import.meta.url`), **not** from the working directory, so it works from any directory. What can break it is a bundler that inlines the package into one file: then `import.meta.url` points at the bundle and the data files are gone. So:

- **Do not bundle the package; keep it external** and make sure `node_modules/@itegro/einvoice/{assets,schematron}` is deployed with your app.
- Plain Node.js servers, Docker images and `npm install` based deployments need nothing special.
- esbuild / tsup / webpack: mark `@itegro/einvoice` as external (`--packages=external`, `externals`).

### Next.js and Vercel

Tell the file tracer to copy the package's data files (**required**: the tracer cannot see paths that are computed at runtime) and keep the package external (recommended, so no bundler can rewrite its module paths):

```js
// next.config.js
module.exports = {
  serverExternalPackages: ['@itegro/einvoice'],
  outputFileTracingIncludes: {
    // route globs -> files relative to the project root
    '/api/invoices/*': ['./node_modules/@itegro/einvoice/{assets,schematron}/**/*'],
  },
};
```

Adjust the route glob to the route handlers that call the library. This was verified with Next.js 16.4 (Turbopack, `output: 'standalone'`): the standalone output, started from a different directory, generated an invoice with the settings above, and failed with `ENOENT ... assets/fonts/DejaVuSans.ttf` without `outputFileTracingIncludes`. With `output: 'standalone'` the included files end up in `.next/standalone/node_modules/...`. `@react-pdf/renderer` is already on Next.js' default list of external packages. The functions need the Node.js runtime (not the Edge runtime) and enough memory (SaxonJS parses a rule set of up to 13 MB on first use; a measurement with the `en16931` profile showed a resident set size of about 200 MB after the first invoice, so give the function at least 512 MB; expect a cold start of a few seconds). Call `preloadAll()` at module scope to pay that cost at start instead of on the first request.

**Prebuilt deployments:** if you build in CI and ship the result with `vercel deploy --prebuilt`, Vercel installs no dependencies, so everything must be in the build output. That is what `outputFileTracingIncludes` does: run `npm ci` and (if you use Factur-X profiles) `npx einvoice-setup-facturx` in the CI job **before** `vercel build`, so the files exist when the tracer runs.

## Development

```sh
git clone https://github.com/Itegro-GmbH/einvoice.git && cd einvoice
npm ci                 # installs and builds (the prepare script runs tsc)
npm run typecheck && npm run lint
npm run setup:verapdf  # veraPDF CLI into tools/verapdf (needs Java 11+), used by the PDF/A tests
npm test               # unit, golden, corpus, property, determinism, PDF/A and visual tests
npm run build          # dist/
npm run smoke          # pack the tarball and install it into empty directories (tarball, URL, Git)
npm run smoke:docker   # the same inside a throw-away node:24-slim container
```

The first `npm test` downloads and compiles the Factur-X rule sets (about a minute, needs network) into `schematron/facturx/`; later runs reuse them. Without veraPDF the PDF/A suite skips itself unless `VERAPDF_REQUIRED=1`. Golden XML is updated with `UPDATE_GOLDEN=1 npx vitest run test/golden`, the visual reference images with `UPDATE_SNAPSHOTS=1 npx vitest run test/visual`.

| Path | Content |
|---|---|
| `src/model`, `src/normalize`, `src/calculate`, `src/validate` | Input schema (Zod), aliases to codes, sums (Decimal, commercial rounding), rule catalog |
| `src/serialize/cii` | CII serializer in Factur-X XSD element order |
| `src/xml-validate`, `schematron/` | SaxonJS Schematron, precompiled rule sets and their sources, Factur-X setup |
| `src/render` | View model, formatting, templates, fonts |
| `src/pdfa` | PDF/A-3B post-processing, `extractXml` |
| `assets/` | Fonts (DejaVu Sans, PT Serif), sRGB ICC profile |
| `test/` | Golden files, example corpus, property tests, veraPDF, visual snapshots |
| `scripts/` | Build helpers, `smoke/` (package smoke tests), `compile-sef.mjs` |

Releases are cut from tags: `vX.Y.Z` on `main` runs `.github/workflows/release.yml` (checks, then GitHub release with the tarball, then npm publication with provenance).

## Contributing

Issues and pull requests are welcome at https://github.com/Itegro-GmbH/einvoice. Please run `npm run typecheck`, `npm run lint` and `npm test` before opening a pull request, keep code, comments and tests in English, and add or update tests for behavior changes. By submitting a contribution you agree that it is licensed under the Apache License 2.0 (section 5 of the license). Please do not include real invoice data in issues.

## License

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). The package also contains third-party fonts, a color profile and compiled Schematron rule sets under their own licenses (OFL, Bitstream Vera, CC0, EUPL 1.2, Apache 2.0); they are listed in [NOTICE](NOTICE). Dependencies keep their own licenses; note that `saxon-js` is distributed under Saxonica's own license (see its `LICENSE.txt`).

## Support

Questions and feedback: support@itegro-gmbh.de, or open an issue on GitHub. This is a community-supported library; there is no service-level agreement.
