# Fonts

- `DejaVuSans.ttf`, `DejaVuSans-Bold.ttf`: DejaVu Fonts 2.37 (Regular and Bold).
  Source: https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip
  License: Bitstream Vera Fonts License / public domain changes (see `LICENSE-DejaVu.txt`). Bundling with software and embedding in PDFs (also as a subset) is permitted; the files are distributed unmodified.
  Registered once per process in `src/render/fonts.ts` (family `DejaVu`).

- `PTSerif-Regular.ttf`, `PTSerif-Bold.ttf`: PT Serif (ParaType), static cuts (not a variable font), used by the `elegant` template.
  Source: https://github.com/google/fonts/tree/main/ofl/ptserif (`PT_Serif-Web-Regular.ttf`, `PT_Serif-Web-Bold.ttf`)
  License: SIL Open Font License 1.1 (see `PTSerif-OFL.txt`). Bundling with software and embedding in PDFs (also as a subset) is permitted; the files are distributed unmodified and not sold by themselves.
  Registered once per process in `src/render/fonts.ts` (family `PTSerif`, `FONT_FAMILY_SERIF`).
