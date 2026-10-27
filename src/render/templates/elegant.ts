/**
 * Template `elegant`: serif typeface (PT Serif, OFL) for headings, invoice number and totals block; the
 * body text (address, table, footer) stays in the sans-serif base font for good readability. A fine
 * double rule in the accent colour below the title, a softly tinted totals block (as with `modern`, a
 * tinted surface is allowed, see `tint()` in shared.ts): a calm, high-quality letter character. Address position as with
 * `classic` (DIN 5008 form B, same page margin, same header height before the address).
 */
import type { ReactElement } from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { FONT_FAMILY, FONT_FAMILY_SERIF } from '../fonts.js';
import { Footer, h, LineTable, lines, Logo, T, Totals, tint, V, Watermark } from './shared.js';
import type { Template, TemplateProps } from './types.js';

const FS = 9;

function styles(accent: string) {
  return StyleSheet.create({
    page: { fontFamily: FONT_FAMILY, fontSize: FS, color: '#26221d', paddingTop: 42, paddingLeft: 70, paddingRight: 56, paddingBottom: 96 },
    // Same minimum height as with `classic` (header + sender line): the address therefore starts at the same Y position on the page
    // regardless of logo/seller name (DIN 5008 window).
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: 48, marginBottom: 12 },
    logo: { maxHeight: 44, maxWidth: 170, objectFit: 'contain', objectPosition: 'right top' },
    sellerName: { fontFamily: FONT_FAMILY_SERIF, fontSize: 13, fontWeight: 'bold', color: '#26221d' },
    senderLine: { fontSize: 6.5, color: '#8a8378', marginBottom: 8 },
    columns: { flexDirection: 'row', marginBottom: 16 },
    addressCol: { width: 240 },
    infoCol: { flexGrow: 1, flexBasis: 0, paddingLeft: 14 },
    infoRow: { flexDirection: 'row', paddingVertical: 0.5 },
    infoLabel: { width: 110, color: '#8a8378' },
    infoValue: { flexGrow: 1, flexBasis: 0 },
    small: { fontSize: 7, color: '#8a8378' },
    title: { fontFamily: FONT_FAMILY_SERIF, fontSize: 19, fontWeight: 'bold', color: accent, marginBottom: 6 },
    // Fine double rule below the title instead of a single line or colour fill: the calm, letter-like accent.
    ruleWide: { borderBottomWidth: 1, borderColor: accent, marginBottom: 2 },
    ruleNarrow: { borderBottomWidth: 0.5, borderColor: accent, marginBottom: 14, opacity: 0.5 },
    preceding: { marginBottom: 6, color: '#6b6459' },
    table: { marginTop: 4 },
    tHead: { flexDirection: 'row', borderBottomWidth: 1, borderColor: accent, paddingBottom: 4, marginBottom: 2 },
    tCellHead: { paddingHorizontal: 2, fontWeight: 'bold', color: '#6b6459', fontSize: 7.5 },
    tRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#e7e2d9', paddingVertical: 4 },
    tCell: { paddingHorizontal: 2 },
    tDesc: { fontSize: 7.5, color: '#8a8378' },
    tNote: { fontSize: 7.5, color: '#8a8378' },
    // Softly tinted surface (10 % accent colour) behind the totals block: text stays dark, sufficient contrast.
    sums: { marginTop: 12, alignSelf: 'flex-end', width: 290, backgroundColor: tint(accent, 0.9), paddingVertical: 6, paddingHorizontal: 10 },
    sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
    sumEmph: { fontFamily: FONT_FAMILY_SERIF, fontWeight: 'bold', borderTopWidth: 0.75, borderColor: accent, marginTop: 2, paddingTop: 4 },
    sumLast: { color: accent, fontSize: 10.5 },
    // `flexBasis: 0`: see classic.ts (otherwise a long allowance/charge label overlaps the amount; this became
    // particularly visible with the serif font, see the stress fixture).
    sumLabel: { flexGrow: 1, flexBasis: 0, paddingRight: 12, fontFamily: FONT_FAMILY_SERIF },
    sumValue: { width: 90, textAlign: 'right', fontFamily: FONT_FAMILY_SERIF },
    vatNote: { marginTop: 4, alignSelf: 'flex-end', width: 290, fontSize: 8, color: '#6b6459' },
    block: { marginTop: 18 },
    blockTitle: { fontFamily: FONT_FAMILY_SERIF, fontWeight: 'bold', color: '#26221d', marginBottom: 2 },
    footer: { position: 'absolute', left: 70, right: 56, bottom: 30, borderTopWidth: 0.75, borderColor: accent, paddingTop: 5 },
    footerCols: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
    footerCol: { width: '50%', paddingRight: 6, marginBottom: 4 },
    footerLine: { fontSize: 6.5, color: '#6b6459', lineHeight: 1.3 },
    footerNote: { fontSize: 6.5, color: '#a39b8d' },
    footerPage: { fontSize: 6.5, color: '#6b6459', textAlign: 'right', marginTop: 2 },
  });
}

const cache = new Map<string, ReturnType<typeof styles>>();
function stylesFor(options: TemplateProps['options']): ReturnType<typeof styles> {
  let st = cache.get(options.accentColor);
  if (st === undefined) {
    st = styles(options.accentColor);
    cache.set(options.accentColor, st);
  }
  return st;
}

function InfoBlock({ vm, s }: Pick<TemplateProps, 'vm'> & { s: ReturnType<typeof styles> }): ReactElement {
  return V(
    s.infoCol,
    ...vm.infoRows.map((r, i) => h(View, { key: i, style: s.infoRow }, T(s.infoLabel, r.label), T(s.infoValue, r.value))),
  );
}

export const elegant: Template = ({ vm, options, watermark }) => {
  const s = stylesFor(options);
  return h(
    Document,
    { title: `${vm.title} ${vm.number}`, language: vm.texts.locale },
    h(
      Page,
      { size: options.pageSize, style: s.page },
      h(Watermark, { text: watermark, color: options.accentColor }),
      V(s.head, T(s.sellerName, vm.seller.name), h(Logo, { options, style: s.logo })),
      T(s.senderLine, vm.senderLine),
      V(
        s.columns,
        V(
          s.addressCol,
          T(s.small, vm.texts.recipient),
          ...lines(vm.buyer.addressLines),
          // In a separate `View` instead of spread into the address column: see classic.ts (bugfix part 1,
          // duplicate React key of `buyer` and `delivery` rows in the same parent node).
          vm.delivery === undefined ? null : V(undefined, T([s.small, { marginTop: 8 }], vm.texts.deliveryAddress), ...lines(vm.delivery.addressLines)),
        ),
        h(InfoBlock, { vm, s }),
      ),
      T(s.title, `${vm.title} ${vm.number}`),
      h(View, { style: s.ruleWide }),
      h(View, { style: s.ruleNarrow }),
      vm.precedingLine === undefined ? null : T(s.preceding, vm.precedingLine),
      h(LineTable, { vm, styles: { table: s.table, head: s.tHead, row: s.tRow, cell: s.tCell, cellHead: s.tCellHead, desc: s.tDesc, note: s.tNote } }),
      h(Totals, {
        vm,
        styles: { block: s.sums, row: s.sumRow, rowEmphasis: s.sumEmph, lastRow: s.sumLast, label: s.sumLabel, value: s.sumValue, note: s.vatNote },
      }),
      vm.payment === undefined ? null : V(s.block, T(s.blockTitle, vm.payment.title), ...lines(vm.payment.lines)),
      vm.notes.length === 0 ? null : V(s.block, T(s.blockTitle, vm.texts.notesTitle), ...lines(vm.notes)),
      h(Footer, { vm, options, styles: { footer: s.footer, columns: s.footerCols, column: s.footerCol, line: s.footerLine, note: s.footerNote, page: s.footerPage } }),
    ),
  );
};

// `Text` is used via T(); the direct import keeps the types visible to editors.
void Text;
