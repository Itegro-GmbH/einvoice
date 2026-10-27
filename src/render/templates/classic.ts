/**
 * Template `classic`: standard letter per DIN 5008 (form B): sender line above the address field, info block on the right,
 * line items table, totals block, payment notes, footer with the seller's master data. Black/grey; the accent colour
 * is only used for the table header line.
 */
import type { ReactElement } from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { FONT_FAMILY } from '../fonts.js';
import { Footer, h, LineTable, lines, Logo, T, Totals, V, Watermark } from './shared.js';
import type { Template, TemplateProps } from './types.js';

const FS = 9;

const s = StyleSheet.create({
  page: { fontFamily: FONT_FAMILY, fontSize: FS, color: '#000000', paddingTop: 42, paddingLeft: 70, paddingRight: 56, paddingBottom: 96 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: 48, marginBottom: 12 },
  logo: { maxHeight: 44, maxWidth: 170, objectFit: 'contain', objectPosition: 'right top' },
  sellerName: { fontSize: 12, fontWeight: 'bold' },
  senderLine: { fontSize: 6.5, color: '#555555', textDecoration: 'underline', marginBottom: 8 },
  columns: { flexDirection: 'row', marginBottom: 22 },
  addressCol: { width: 240 },
  // `paddingLeft` reduced from 24 to 14: gives the value column (`infoValue`) enough room so that short values
  // (e.g. "Erika Muster") do not wrap needlessly, while the gap to the address stays clearly visible.
  // `flexBasis: 0`: without it, yoga measures the width in a first pass against the content (here: only `infoLabel`, since
  // `infoValue` itself already has `flexBasis: 0` and enters this measurement as 0), so line-break decisions
  // in `infoValue` are wrongly made against a too narrow width, even if the column ends up wider.
  infoCol: { flexGrow: 1, flexBasis: 0, paddingLeft: 14 },
  infoRow: { flexDirection: 'row' },
  infoLabel: { width: 110, color: '#555555' },
  // `flexBasis: 0` next to `flexGrow: 1`: without it, the width is based on the unbroken text width (yoga flexbox
  // pitfall, see COLS.name in shared.ts), so a long value (e.g. "01.08.2026 – 31.08.2026") sticks out past the
  // right margin instead of wrapping in the column (bugfix part 1).
  infoValue: { flexGrow: 1, flexBasis: 0 },
  small: { fontSize: 7, color: '#555555' },
  title: { fontSize: 15, fontWeight: 'bold', marginBottom: 2 },
  preceding: { marginBottom: 6 },
  table: { marginTop: 12 },
  tHead: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#000000', paddingBottom: 3, marginBottom: 2 },
  tRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#bbbbbb', paddingVertical: 3 },
  tCell: { paddingHorizontal: 2 },
  tCellHead: { paddingHorizontal: 2, fontWeight: 'bold' },
  tDesc: { fontSize: 7.5, color: '#444444' },
  tNote: { fontSize: 7.5, color: '#444444' },
  sums: { marginTop: 8, alignSelf: 'flex-end', width: 290 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5, paddingHorizontal: 2 },
  sumEmph: { fontWeight: 'bold', borderTopWidth: 0.75, borderColor: '#000000', marginTop: 2, paddingTop: 3 },
  // `flexBasis: 0`: the same yoga pitfall as for infoValue; without it, a long wrapping label
  // (e.g. a long allowance/charge reason) overlaps the right-aligned amount instead of staying cleanly in its column.
  sumLabel: { flexGrow: 1, flexBasis: 0, paddingRight: 12 },
  sumValue: { width: 90, textAlign: 'right' },
  vatNote: { marginTop: 4, alignSelf: 'flex-end', width: 290, fontSize: 8, color: '#333333' },
  block: { marginTop: 18 },
  blockTitle: { fontWeight: 'bold', marginBottom: 2 },
  footer: { position: 'absolute', left: 70, right: 56, bottom: 30, borderTopWidth: 0.5, borderColor: '#999999', paddingTop: 5 },
  // 2 columns per row instead of up to 4 equally wide ones: a single column (e.g. bank: IBAN + BIC) was too narrow with up to
  // four columns for an unbroken IBAN group, so the last 2-digit group landed alone on a
  // separate line (bugfix part 1). `flexWrap` allows 1 to 4 present columns (depending on which footer fields are filled).
  footerCols: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  footerCol: { width: '50%', paddingRight: 6, marginBottom: 4 },
  footerLine: { fontSize: 6.5, color: '#444444', lineHeight: 1.3 },
  footerNote: { fontSize: 6.5, color: '#777777' },
  footerPage: { fontSize: 6.5, color: '#444444', textAlign: 'right', marginTop: 2 },
});

function InfoBlock({ vm }: Pick<TemplateProps, 'vm'>): ReactElement {
  return V(
    s.infoCol,
    ...vm.infoRows.map((r, i) => h(View, { key: i, style: s.infoRow }, T(s.infoLabel, r.label), T(s.infoValue, r.value))),
  );
}

export const classic: Template = ({ vm, options, watermark }) =>
  h(
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
          // In a separate `View` instead of spread into the address column: otherwise the rows of `buyer` and
          // `delivery` (both via `lines()`, which keys locally from index 0) carry the same React key in the same
          // parent node (bugfix part 1, visible with a delivery address in the stress fixture).
          vm.delivery === undefined ? null : V(undefined, T([s.small, { marginTop: 8 }], vm.texts.deliveryAddress), ...lines(vm.delivery.addressLines)),
        ),
        h(InfoBlock, { vm }),
      ),
      T(s.title, `${vm.title} ${vm.number}`),
      vm.precedingLine === undefined ? null : T(s.preceding, vm.precedingLine),
      h(LineTable, { vm, styles: { table: s.table, head: s.tHead, row: s.tRow, cell: s.tCell, cellHead: s.tCellHead, desc: s.tDesc, note: s.tNote } }),
      h(Totals, { vm, styles: { block: s.sums, row: s.sumRow, rowEmphasis: s.sumEmph, label: s.sumLabel, value: s.sumValue, note: s.vatNote } }),
      vm.payment === undefined ? null : V(s.block, T(s.blockTitle, vm.payment.title), ...lines(vm.payment.lines)),
      vm.notes.length === 0 ? null : V(s.block, T(s.blockTitle, vm.texts.notesTitle), ...lines(vm.notes)),
      h(Footer, { vm, options, styles: { footer: s.footer, columns: s.footerCols, column: s.footerCol, line: s.footerLine, note: s.footerNote, page: s.footerPage } }),
    ),
  );

// `Text` is used via T(); the direct import keeps the types visible to editors.
void Text;
