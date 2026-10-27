# ICC profiles

- `sRGB-v2-magic.icc`: compact sRGB ICC profile (ICC v2, 736 bytes) from
  https://github.com/saucecontrol/Compact-ICC-Profiles. License: CC0 1.0 (see `LICENSE-CC0.txt`).
- Used as the OutputIntent (`GTS_PDFA1`, `/N 3`) in the PDF/A-3 output (`src/pdfa/to-pdfa3.ts`); veraPDF 1.30.2 accepts it (rules 6.2.2/6.2.3).
- `sRGB2014.icc` from color.org can only be downloaded behind a registration page. If an auditor requires the registry profile, obtain it manually and place it here.
