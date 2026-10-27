# Validation artifacts (Schematron as SEF): origin and versions

All artifacts are versioned dependencies: origin, release tag, date and license are recorded here.
The SEF files are produced with `npm run compile-sef` from the XSLTs kept in this repository and are
committed. They are loaded only through `src/xml-validate/artifacts.ts`. Only the `*.sef.json`
files are part of the published npm package; the XSLT/Schematron sources stay in the repository
for traceability (and, for the EUPL-licensed EN 16931 rules, as the corresponding source code).

As of: 2026-09-12.

## Overview

| Rule set | Version | Source | License | Files in this repository |
|---|---|---|---|---|
| EN 16931 CII (CEN/TC 434) | Schematron **1.3.16** (release `validation-1.3.16`, 2026-04-13) | [ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/tag/validation-1.3.16), asset `en16931-cii-1.3.16.zip`, path `xslt/EN16931-CII-validation.xslt` | EUPL 1.2 (`../licenses/EUPL-1.2.txt`) | `en16931/EN16931-CII-validation.xslt`, `.sef.json` |
| **XRechnung** CII (KoSIT) | Schematron **2.6.0** for **XRechnung 3.0.2** (release `v2.6.0`, 2026-09-02) | [itplr-kosit/xrechnung-schematron](https://github.com/itplr-kosit/xrechnung-schematron/releases/tag/v2.6.0), asset `xrechnung-3.0.2-schematron-2.6.0.zip`, paths `schematron/cii/XRechnung-CII-validation.{sch,xsl}`, `schematron/common.sch` | Apache 2.0 (`xrechnung/LICENSE-Apache-2.0.txt`) | `xrechnung/XRechnung-CII-validation.xsl`, `.sch`, `common.sch`, `.sef.json` |
| Factur-X / ZUGFeRD profiles **BASIC**, **EN16931**, **EXTENDED** | Factur-X **1.09.2** (release 2026-08-04, effective 2026-09-01) | Not stored here, see below | no redistribution license found | none (built on the user's machine) |

Specification identifier for XRechnung (BT-24) that this release expects (`common.sch`,
`$XR-MAJOR-MINOR-VERSION = '3.0'`): `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`,
which equals `PROFILE_URNS.xrechnung`.

## Factur-X rule sets are not part of the repository or the package

The Factur-X / ZUGFeRD Schematron stylesheets are published by FNFE-MPE and FeRD. The original
packages are only available behind a registration form, the publishers' sites carry no
redistribution license for them, and the Apache-2.0 mirror in the mustangproject repository
cannot grant rights on the publishers' behalf. They are therefore neither committed nor
packaged. `npx einvoice-setup-facturx` (source: `src/xml-validate/facturx-setup.ts`) downloads them
from a pinned commit of that public mirror (mustangproject commit
`abf4544f4d555b8c42e0c4edf7d6241a1d3da2c3`, path `validator/src/main/resources/xslt/ZF_250/`),
verifies the pinned SHA-256 checksum of every file, applies the patches below and compiles them
into `schematron/facturx/` (git-ignored) or the directory named by `EINVOICE_FACTURX_DIR`.
The version metadata is in the header of each code list (`Factur-X release metadata: Version 1.09.2,
Release date 2026-08-04, Effective date 2026-09-01`).

## Compilation

- Tool: `xslt3` 2.7.0 (SaxonJS), options `-nogo -relocate:on`. Runtime: `saxon-js` 2.7.x.
- **Factur-X code list** (applied by `einvoice-setup-facturx`): the stylesheets load their code
  lists with `document('FACTUR-X_<PROFILE>_codedb.xml')`, which needs a base URI at runtime
  (spike finding `XTDE1162`). The code list is embedded before compiling as a string variable
  (`$fxCodedbText`), parsed by `parse-xml()` into `$fxCodedb`, and every `document(...)` call is
  replaced. The compiled files are self-contained (no file access, no base URI).
- **SaxonJS workaround (EXTENDED only):** SaxonJS 2.7 fails at runtime with `XPTY0004` for
  `round(<double>) div xs:decimal(100)`. Affected: the tolerance rules BR-FXEXT-CO-10, -11 and -13
  (4 occurrences). The setup replaces `div xs:decimal(100)` with `div 100` (semantically identical)
  and aborts if the occurrence count is no longer 4.
- **SaxonJS workaround (XRechnung only):** `xr:checkIBAN` computes `xs:integer(<up to 34 digits>) mod 97`;
  SaxonJS 2.7 holds xs:integer as a double (53 bits), so the result is wrong and every valid IBAN
  would trigger BR-DE-19/BR-DE-20 (warning). `scripts/compile-sef.mjs` replaces the expression with an exact
  digit-by-digit mod-97 computation (`fold-left`), mathematically identical.
- SEF files are not byte-reproducible (SaxonJS writes `buildDateTime` plus a checksum) but are functionally identical.
  The `base` URIs inside the committed SEFs point to a temporary directory (`compile-sef.mjs` always compiles from a copy there); they are not used at runtime.

## SEF sizes (as of this compilation)

| SEF | Bytes |
|---|---|
| `en16931/EN16931-CII-validation.sef.json` | 5 024 836 (4 907 KB) |
| `xrechnung/XRechnung-CII-validation.sef.json` | 1 751 380 (1 710 KB) |
| Factur-X BASIC / EN16931 / EXTENDED (built locally) | about 4.1 MB / 5.3 MB / 12.9 MB |
