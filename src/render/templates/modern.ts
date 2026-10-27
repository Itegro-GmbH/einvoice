/**
 * Template `modern`: accent colour as a bar at the page header and in table header/headings, compact info block,
 * slimmer footer. Same building blocks as `classic`.
 */
import type { ReactElement } from 'react';
import { Document, Page, StyleSheet, View } from '@react-pdf/renderer';
import { FONT_FAMILY } from '../fonts.js';
import type { TemplateOptions } from '../template-options.js';
import { Footer, h, LineTable, lines, Logo, T, Totals, V, Watermark } from './shared.js';
import type { Template, TemplateProps } from './types.js';

const FS = 8.5;

function styles(accent: string) {
  return StyleSheet.create({
    // `paddingBottom` raised from 84 to 98: with all footer fields filled (stress fixture), the
    // reserved space was not enough for the (up to) two-line column footer, and the last table row overlapped the
    // footer (bugfix part 1, "what breaks in modern").
    page: { fontFamily: FONT_FAMILY, fontSize: FS, color: '#1a1a1a', paddingTop: 40, paddingLeft: 48, paddingRight: 48, paddingBottom: 132 },
    bar: { position: 'absolute', top: 0, left: 0, right: 0, height: 14, backgroundColor: accent },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
    headLeft: { width: 260 },
    // `flexGrow: 1, flexBasis: 0`: without it, `headRight` is sized by the unbroken width of seller name/
    // address (yoga pitfall, see infoValue), so a long trade name sticks out past the right margin
    // instead of wrapping in the column (bugfix part 1, "what breaks in modern", visible with the stress fixture).
    headRight: { flexGrow: 1, flexBasis: 0, alignItems: 'flex-end' },
    logo: { maxHeight: 40, maxWidth: 160, objectFit: 'contain', objectPosition: 'right top', marginBottom: 4 },
    sellerName: { fontSize: 11, fontWeight: 'bold', color: accent },
    sellerLine: { fontSize: 7, color: '#666666' },
    title: { fontSize: 20, fontWeight: 'bold', color: accent, marginBottom: 2 },
    preceding: { marginBottom: 4, color: '#444444' },
    columns: { flexDirection: 'row', marginBottom: 18 },
    addressCol: { width: 260 },
    small: { fontSize: 6.5, color: accent, fontWeight: 'bold', marginBottom: 2 },
    // `flexBasis: 0`: see classic.ts (prevents an `infoValue` column measured too narrow by a
    // two-pass yoga measurement).
    infoCol: { flexGrow: 1, flexBasis: 0, paddingLeft: 14 },
    infoRow: { flexDirection: 'row', paddingVertical: 0.5 },
    infoLabel: { width: 104, color: '#666666' },
    // `flexBasis: 0`: see classic.ts; without it, a long value sticks out past the right margin instead of wrapping.
    infoValue: { flexGrow: 1, flexBasis: 0, fontWeight: 'bold' },
    table: { marginTop: 6 },
    tHead: { flexDirection: 'row', backgroundColor: accent, paddingVertical: 4, marginBottom: 2 },
    tRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#dddddd', paddingVertical: 3 },
    tCell: { paddingHorizontal: 3 },
    tCellHead: { paddingHorizontal: 3, fontWeight: 'bold', color: '#ffffff' },
    tDesc: { fontSize: 7, color: '#555555' },
    tNote: { fontSize: 7, color: '#555555' },
    sums: { marginTop: 8, alignSelf: 'flex-end', width: 280 },
    sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5, paddingHorizontal: 3 },
    sumEmph: { fontWeight: 'bold', borderTopWidth: 1, borderColor: accent, marginTop: 2, paddingTop: 3, color: accent },
    // `flexBasis: 0`: see classic.ts (otherwise a long allowance/charge label overlaps the amount).
    sumLabel: { flexGrow: 1, flexBasis: 0, paddingRight: 12 },
    sumValue: { width: 90, textAlign: 'right' },
    vatNote: { marginTop: 4, alignSelf: 'flex-end', width: 280, fontSize: 7.5, color: '#444444' },
    block: { marginTop: 14 },
    blockTitle: { fontWeight: 'bold', color: accent, marginBottom: 2 },
    footer: { position: 'absolute', left: 48, right: 48, bottom: 26, borderTopWidth: 1, borderColor: accent, paddingTop: 5 },
    // 2 columns per row instead of up to 4 equally wide ones: see classic.ts (bugfix part 1, IBAN wrapping).
    footerCols: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 3 },
    footerCol: { width: '50%', paddingRight: 6, marginBottom: 3 },
    footerLine: { fontSize: 6.5, color: '#555555', lineHeight: 1.3 },
    footerNote: { fontSize: 6.5, color: '#888888' },
    footerPage: { fontSize: 6.5, color: '#555555', textAlign: 'right', marginTop: 2 },
  });
}

const cache = new Map<string, ReturnType<typeof styles>>();
function stylesFor(options: TemplateOptions): ReturnType<typeof styles> {
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

export const modern: Template = ({ vm, options, watermark }) => {
  const s = stylesFor(options);
  return h(
    Document,
    { title: `${vm.title} ${vm.number}`, language: vm.texts.locale },
    h(
      Page,
      { size: options.pageSize, style: s.page },
      h(Watermark, { text: watermark, color: options.accentColor }),
      h(View, { fixed: true, style: s.bar }),
      V(
        s.head,
        V(s.headLeft, T(s.title, vm.title), vm.precedingLine === undefined ? null : T(s.preceding, vm.precedingLine)),
        V(s.headRight, h(Logo, { options, style: s.logo }), T(s.sellerName, vm.seller.name), ...lines(vm.seller.addressLines.slice(1), s.sellerLine)),
      ),
      V(
        s.columns,
        V(
          s.addressCol,
          T(s.small, vm.texts.recipient.toUpperCase()),
          ...lines(vm.buyer.addressLines),
          // In a separate `View` instead of spread into the address column: see classic.ts (bugfix part 1,
          // duplicate React key of `buyer` and `delivery` rows in the same parent node).
          vm.delivery === undefined
            ? null
            : V(undefined, T([s.small, { marginTop: 8 }], vm.texts.deliveryAddress.toUpperCase()), ...lines(vm.delivery.addressLines)),
        ),
        h(InfoBlock, { vm, s }),
      ),
      h(LineTable, { vm, styles: { table: s.table, head: s.tHead, row: s.tRow, cell: s.tCell, cellHead: s.tCellHead, desc: s.tDesc, note: s.tNote } }),
      h(Totals, { vm, styles: { block: s.sums, row: s.sumRow, rowEmphasis: s.sumEmph, label: s.sumLabel, value: s.sumValue, note: s.vatNote } }),
      vm.payment === undefined ? null : V(s.block, T(s.blockTitle, vm.payment.title), ...lines(vm.payment.lines)),
      vm.notes.length === 0 ? null : V(s.block, T(s.blockTitle, vm.texts.notesTitle), ...lines(vm.notes)),
      h(Footer, { vm, options, styles: { footer: s.footer, columns: s.footerCols, column: s.footerCol, line: s.footerLine, note: s.footerNote, page: s.footerPage } }),
    ),
  );
};
