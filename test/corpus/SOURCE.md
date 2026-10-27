# Example corpus: origin and licenses

Official or publicly maintained CII instances (XML only, no PDFs) used as fixtures for two tests:

- **(i) `corpus.test.ts`**: every instance runs through `validateXml` (EN 16931 plus the profile rule set) with 0 errors;
  known outliers are listed in `KNOWN_FINDINGS` there with rule ID and reason.
- **(ii) `corpus-equivalence.test.ts`**: for the instances in `inputs/` an equivalent input JSON exists; the XML
  generated from it is compared with the original by XPath on the business content (totals, VAT breakdown, lines,
  profile URN, ...).

As of: 2026-09-12. Third-party attributions are also listed in the repository's `NOTICE`.

| Directory | Source | Version / commit | License | Files |
|---|---|---|---|---|
| `en16931/` | [ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931), release `validation-1.3.16`, asset `en16931-cii-1.3.16.zip`, path `examples/CII_example1.xml` | 1.3.16 (2026-04-13) | EUPL 1.2 (`../../licenses/EUPL-1.2.txt`; the file itself carries the notice) | 1 |
| `xrechnung-testsuite/` | [itplr-kosit/xrechnung-testsuite](https://github.com/itplr-kosit/xrechnung-testsuite), release `v2026-08-31`, asset `xrechnung-3.0.2-testsuite-2026-08-31.zip`, paths `instances/standard/*_uncefact.xml`, `instances/technical-cases/{cius,cvd}/*_uncefact.xml`, `instances/extension/04.05a-INVOICE_uncefact.xml` | XRechnung 3.0.2, test suite 2026-08-31 | Apache 2.0 (repository license; individual files may carry their own Apache notice) | 25 |
| `mustangproject/` | [ZUGFeRD/mustangproject](https://github.com/ZUGFeRD/mustangproject), commit `abf4544f4d555b8c42e0c4edf7d6241a1d3da2c3` (2026-09-10), paths `library/src/test/resources/{cii/,}*.xml`, `validator/src/test/resources/*.xml` (CII instances with a Factur-X 1.0, EN 16931 or XRechnung identifier only) | master 2026-09-10 | Apache 2.0 (repository license) | 20 |

## Selection and exclusions

- **Files carrying FeRD / FNFE-MPE usage terms are not included.** Several instances in the mustangproject
  repository are copies of official ZUGFeRD or Factur-X example files and contain a "Nutzungsrechte" (terms of use)
  comment of FeRD. Those terms grant a license to use the ZUGFeRD data format; they do not clearly permit
  redistributing the example files. They were removed: `attributeBasedXMP_zugferd_2p0_EN16931_Einfach_corrected.xml`,
  `X03_01_Abschlagsrechnung_SubInvoiceLine_u_LV_Nr.xml`, `factur-x-extended.xml`, `validV2Basic.xml`, and the FNFE examples
  `UC10_F202600004_EXTENDED_FX_CII_Commentee.xml` and `UC11_F202600022_EXTENDED_FX_CII_BT-X-589Only_on_GROUP_Line.xml`.
  The remaining mustangproject files carry no third-party notice and are covered by that repository's Apache-2.0 license.
- **Factur-X package (fnfe-mpe.org):** the official example invoices are only available through a registration form
  (checked 2026-09-12); they are not used.
- **XRechnung test suite:** 16 of the 41 CII instances contain embedded attachments (`AttachmentBinaryObject`, Base64 PDFs,
  210-435 KB each, about 4 MB together) and were **not** taken over; attachments (BG-24) are not part of the model yet. UBL instances are
  out of scope (CII only).
- **mustangproject:** not taken over were files with a ZUGFeRD 2.0 identifier (`urn:zugferd.de:2p0:*`, no longer accepted by
  Factur-X 1.09.2), the MINIMUM profile (`facturFrMinimum.xml`, `valid_Avoir_FR_type380_minimum...`, not a profile of this
  product), the migration reference `migration/reference/ZUGFeRD2_COMFORT_Einfach.xml` (ZUGFeRD 1 style with `currencyID` on all
  amounts, 34 CII-DT-031 errors, not an example), and all negative cases marked `invalid*` / `FAIL_*`.

## Changes to the files

None. All instances are byte-identical to their source. The input JSONs in `inputs/` are our own re-creations (mandatory address
fields that are missing in the original are filled with placeholders; VAT IDs in placeholder format were replaced by
`DE123456789`; these fields are not compared).
