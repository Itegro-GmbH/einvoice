# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-27

First public release. The library was developed as an internal module and is now published as a
standalone package.

### Added

- `generate()`: invoice data in, `{ xml, pdf, warnings, profile, meta }` out. The PDF is PDF/A-3B
  with the CII XML embedded as `factur-x.xml`; the output is byte-identical for identical input.
- `generateXml()`, `validateXml()`, `extractXml()` and the individual pipeline stages
  (`normalize`, `calculate`, `validate`, `serializeCii`, `toViewModel`, `renderInvoice`, `toPdfA3`).
- Profiles `basic`, `en16931`, `extended` and `xrechnung` (XRechnung 3.0.2, with Leitweg-ID and
  electronic addresses).
- Cent-exact calculation with commercial rounding; more than 100 validation rules reported as
  structured `violations` (`rule`, `path`, `businessTerm`, `message`, `hint`).
- Schematron validation of the generated XML through SaxonJS with the EN 16931 and XRechnung
  rule sets (precompiled, shipped in the package).
- Four PDF templates (`classic`, `modern`, `minimal`, `elegant`) with accent color, logo and
  footer text options.
- `einvoice-setup-facturx` command and `installFacturxRuleSets()` function that download, verify
  (SHA-256) and compile the Factur-X / ZUGFeRD Schematron rule sets on the user's machine.
- Warning `IF-WARN-100` and the `requireAllRuleSets` option for the case that those rule sets
  are not installed.
- ESM build with type declarations; fonts, ICC profile and rule sets are resolved relative to
  the installed package, independent of the working directory.
- Package smoke tests (installed tarball, release URL, Git dependency, Linux containers) and CI
  and release workflows.

### Notes

- License: Apache-2.0. Third-party data files and their licenses are listed in `NOTICE`.
- The Factur-X rule sets are not shipped because their publishers do not grant a redistribution
  license; see the README section "Factur-X rule sets".

[Unreleased]: https://github.com/Itegro-GmbH/einvoice/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Itegro-GmbH/einvoice/releases/tag/v0.1.0
