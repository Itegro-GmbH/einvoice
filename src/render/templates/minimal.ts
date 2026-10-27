/**
 * Template `minimal`: lots of whitespace, no colour fills, hairlines only; hierarchy via size/weight/grey instead of
 * colour. The accent colour appears in exactly one place: the amount due (`lastRow` of `Totals` in `shared.ts`).
 * Small logo at the top left; address position as with `classic` (DIN 5008 form B, same page margin, same
 * header height before the address).
 */
import type { ReactElement } from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { FONT_FAMILY } from '../fonts.js';
import { Footer, h, LineTable, lines, Logo, T, Totals, V, Watermark } from './shared.js';
import type { Template, TemplateProps } from './types.js';

const FS = 9;

function styles(accent: string) {
  return StyleSheet.create({
    page: { fontFamily: FONT_FAMILY, fontSize: FS, color: '#1a1a1a', paddingTop: 42, paddingLeft: 70, paddingRight: 56, paddingBottom: 96 },
    // Same minimum height as with `classic` (header + sender line): the address therefore starts at the same Y position on the page
    // regardless of logo/seller name (DIN 5008 window).
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: 48, marginBottom: 12 },
    logo: { maxHeight: 26, maxWidth: 110, objectFit: 'contain', objectPosition: 'left top' },
    sellerName: { fontSize: 9, color: '#666666' },
    senderLine: { fontSize: 6.5, color: '#999999', marginBottom: 8 },
    columns: { flexDirection: 'row', marginBottom: 16 },
    addressCol: { width: 240 },
    infoCol: { flexGrow: 1, flexBasis: 0, paddingLeft: 14 },
    infoRow: { flexDirection: 'row', paddingVertical: 0.5 },
    infoLabel: { width: 110, color: '#999999' },
    infoValue: { flexGrow: 1, flexBasis: 0, color: '#1a1a1a' },
    small: { fontSize: 6.5, color: '#999999' },
    rule: { borderBottomWidth: 0.5, borderColor: '#dddddd', marginBottom: 18 },
    title: { fontSize: 15, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 2 },
    preceding: { marginBottom: 6, color: '#666666' },
    table: { marginTop: 14 },
    tHead: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#1a1a1a', paddingBottom: 4, marginBottom: 2 },
    tCellHead: { paddingHorizontal: 2, color: '#999999', fontSize: 7.5 },
    tRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#eeeeee', paddingVertical: 4 },
    tCell: { paddingHorizontal: 2 },
    tDesc: { fontSize: 7.5, color: '#999999' },
    tNote: { fontSize: 7.5, color: '#999999' },
    sums: { marginTop: 10, alignSelf: 'flex-end', width: 280 },
    sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, paddingHorizontal: 2 },
    // Grand total: hairline + bold only, stays neutral grey/black.
    sumEmph: { fontWeight: 'bold', borderTopWidth: 0.5, borderColor: '#1a1a1a', marginTop: 2, paddingTop: 4 },
    // Amount due (last row): the only place with the accent colour in the whole template.
    sumLast: { color: accent },
    // `flexBasis: 0`: see classic.ts (otherwise a long allowance/charge label overlaps the amount).
    sumLabel: { flexGrow: 1, flexBasis: 0, paddingRight: 12 },
    sumValue: { width: 90, textAlign: 'right' },
    vatNote: { marginTop: 4, alignSelf: 'flex-end', width: 280, fontSize: 7.5, color: '#999999' },
    block: { marginTop: 16 },
    blockTitle: { fontWeight: 'bold', color: '#1a1a1a', marginBottom: 2 },
    footer: { position: 'absolute', left: 70, right: 56, bottom: 30, borderTopWidth: 0.5, borderColor: '#dddddd', paddingTop: 5 },
    footerCols: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
    footerCol: { width: '50%', paddingRight: 6, marginBottom: 4 },
    footerLine: { fontSize: 6.5, color: '#999999', lineHeight: 1.3 },
    footerNote: { fontSize: 6.5, color: '#bbbbbb' },
    footerPage: { fontSize: 6.5, color: '#999999', textAlign: 'right', marginTop: 2 },
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

export const minimal: Template = ({ vm, options, watermark }) => {
  const s = stylesFor(options);
  return h(
    Document,
    { title: `${vm.title} ${vm.number}`, language: vm.texts.locale },
    h(
      Page,
      { size: options.pageSize, style: s.page },
      h(Watermark, { text: watermark, color: options.accentColor }),
      V(s.head, h(Logo, { options, style: s.logo }), T(s.sellerName, vm.seller.name)),
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
      h(View, { style: s.rule }),
      T(s.title, `${vm.title} ${vm.number}`),
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
