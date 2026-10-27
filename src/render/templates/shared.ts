/**
 * Shared skeleton of the templates: building blocks without text (all texts come from `vm.texts`) and without business logic.
 * No JSX: `React.createElement` via `h`, so that Vitest/ESLint/tsc need no JSX configuration.
 */
import React, { type ReactElement, type ReactNode } from 'react';
import { Image, Text, View, type Styles } from '@react-pdf/renderer';
import { fill } from '../format.js';
import type { TemplateOptions } from '../template-options.js';
import type { InvoiceViewModel, LineView, TotalRow } from '../view-model.js';

export const h = React.createElement;

/** `#rrggbb` mixed with white (`ratio` = share of white, 0..1), e.g. a softly tinted surface derived from the accent colour. */
export function tint(hex: string, ratio: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (channel: number): number => Math.round(channel + (255 - channel) * ratio);
  const r = mix((n >> 16) & 0xff);
  const g = mix((n >> 8) & 0xff);
  const b = mix(n & 0xff);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A single style (react-pdf does not export `Style` directly). */
export type Style = Styles[string];

/** Colour/dimension scheme of a template. */
export interface Theme {
  accent: string;
  text: string;
  muted: string;
  rule: string;
  /** Background of the table header row; `undefined` = none. */
  tableHeadBg?: string;
  tableHeadText: string;
  fontSize: number;
}

export type StyleProp = Style | Style[];

export function T(style: StyleProp | undefined, ...children: ReactNode[]): ReactElement {
  return h(Text, style === undefined ? {} : { style }, ...children);
}

export function V(style: StyleProp | undefined, ...children: ReactNode[]): ReactElement {
  return h(View, style === undefined ? {} : { style }, ...children);
}

export function lines(items: readonly string[], style?: StyleProp): ReactElement[] {
  return items.map((s, i) => h(Text, { key: i, ...(style === undefined ? {} : { style }) }, s));
}

/** Logo (PNG/JPEG) from the template options; `undefined` without a logo. */
export function Logo({ options, style }: { options: TemplateOptions; style: Style }): ReactElement | null {
  const logo = options.logo;
  if (logo === undefined) return null;
  return h(Image, { style, src: { data: Buffer.from(logo.data), format: logo.mime === 'image/png' ? 'png' : 'jpg' } });
}

/**
 * Watermark: diagonal across the page centre, on every page (`fixed`), drawn as the first child of the page
 * (content lies on top). Semi-transparent (ExtGState `/ca`), permitted in PDF/A-3 with an OutputIntent, verified with veraPDF
 * (docs/reports/phase1d.md); the fallback without alpha would be a light colour.
 */
export function Watermark({ text, color }: { text: string | undefined; color: string }): ReactElement | null {
  if (text === undefined || text === '') return null;
  return h(
    View,
    { fixed: true, style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' } },
    h(Text, { style: { fontSize: 72, fontWeight: 'bold', color, opacity: 0.15, transform: 'rotate(-40deg)' } }, text),
  );
}

export interface TableStyles {
  table: Style;
  head: Style;
  row: Style;
  cell: Style;
  cellHead: Style;
  desc: Style;
  note: Style;
}

const COLS = {
  pos: { width: 28 },
  name: { flexGrow: 1, flexBasis: 0 },
  qty: { width: 48, textAlign: 'right' },
  unit: { width: 52, textAlign: 'right' },
  price: { width: 74, textAlign: 'right' },
  vat: { width: 44, textAlign: 'right' },
  net: { width: 84, textAlign: 'right' },
} as const satisfies Record<string, Style>;

/** Line items table with a header row on every page (`fixed`); rows are not split (`wrap: false`). */
export function LineTable({ vm, styles }: { vm: InvoiceViewModel; styles: TableStyles }): ReactElement {
  const t = vm.texts;
  const headCell = (col: Style, text: string): ReactElement => h(Text, { style: [styles.cellHead, col] }, text);
  const cell = (col: Style, text: string): ReactElement => h(Text, { style: [styles.cell, col] }, text);
  const row = (line: LineView, i: number): ReactElement =>
    h(
      View,
      { key: i, style: styles.row, wrap: false },
      cell(COLS.pos, line.pos),
      h(
        View,
        { style: [styles.cell, COLS.name] },
        h(Text, {}, line.name),
        line.description === undefined ? null : h(Text, { style: styles.desc }, line.description),
        ...line.notes.map((n, j) => h(Text, { key: j, style: styles.note }, n)),
      ),
      cell(COLS.qty, line.quantity),
      cell(COLS.unit, line.unit),
      cell(COLS.price, line.unitPrice),
      cell(COLS.vat, line.vat),
      cell(COLS.net, line.netAmount),
    );
  return h(
    View,
    { style: styles.table },
    h(
      View,
      { style: styles.head, fixed: true },
      headCell(COLS.pos, t.colPos),
      headCell(COLS.name, t.colName),
      headCell(COLS.qty, t.colQuantity),
      headCell(COLS.unit, t.colUnit),
      headCell(COLS.price, t.colUnitPrice),
      headCell(COLS.vat, t.colVat),
      headCell(COLS.net, t.colNet),
    ),
    ...vm.lines.map(row),
  );
}

export interface TotalsStyles {
  block: Style;
  row: Style;
  rowEmphasis: Style;
  /**
   * Additional style ONLY for the last row (amount due), optional; unused (`undefined`) changes nothing for
   * `classic`/`modern`. `minimal`/`elegant` set it to restrict the accent colour to exactly this one place,
   * instead of (like `rowEmphasis`) also colouring the grand total.
   */
  lastRow?: Style;
  label: Style;
  value: Style;
  note: Style;
}

/** Totals block (right-aligned), wrapping as a whole (`wrap: false`), with tax notes below. */
export function Totals({ vm, styles }: { vm: InvoiceViewModel; styles: TotalsStyles }): ReactElement {
  const last = vm.totals.length - 1;
  const row = (r: TotalRow, i: number): ReactElement => {
    const rowStyle: Style[] = [styles.row];
    if (r.emphasis === true) rowStyle.push(styles.rowEmphasis);
    if (i === last && styles.lastRow !== undefined) rowStyle.push(styles.lastRow);
    return h(View, { key: i, style: rowStyle }, h(Text, { style: styles.label }, r.label), h(Text, { style: styles.value }, r.value));
  };
  return h(
    View,
    { wrap: false },
    h(View, { style: styles.block }, ...vm.totals.map(row)),
    ...vm.vatNotes.map((n, i) => h(Text, { key: i, style: styles.note }, n)),
  );
}

export interface FooterStyles {
  footer: Style;
  columns: Style;
  column: Style;
  line: Style;
  note: Style;
  page: Style;
}

/** Footer on every page: master data columns, note about factur-x.xml, optional additional text, "Seite n von m" (page n of m). */
export function Footer({ vm, options, styles }: { vm: InvoiceViewModel; options: TemplateOptions; styles: FooterStyles }): ReactElement {
  return h(
    View,
    { fixed: true, style: styles.footer },
    h(
      View,
      { style: styles.columns },
      ...vm.footerColumns.map((col, i) => h(View, { key: i, style: styles.column }, ...lines(col, styles.line))),
    ),
    options.footerText === undefined ? null : h(Text, { style: styles.note }, options.footerText),
    h(Text, { style: styles.note }, vm.embeddedNote),
    h(Text, {
      style: styles.page,
      render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => fill(vm.texts.page, { n: pageNumber, m: totalPages }),
    }),
  );
}

