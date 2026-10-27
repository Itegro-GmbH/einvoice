/**
 * Small, deterministic XML builder for CII serialization.
 *
 * - Elements are written in the given order (the order is fixed by the XSD, see cii/).
 * - Elements with no text and no children are **not** written (PEPPOL-EN16931-R008 "no empty
 *   elements"), unless `keepEmpty` is set (for mandatory XSD elements such as
 *   `ram:ApplicableHeaderTradeDelivery`).
 * - Text elements with an `undefined`/empty value are dropped. Attributes with `undefined` are dropped.
 * - Escaping of & < > " ' in text and attributes; control characters invalid in XML 1.0 are removed.
 * - Indentation 2 spaces, text elements on one line, LF line endings, UTF-8 XML declaration.
 */

export interface XmlElement {
  name: string;
  attrs: ReadonlyArray<readonly [string, string]>;
  children: XmlElement[];
  text: string | undefined;
  keepEmpty: boolean;
}

export type XmlChild = XmlElement | undefined | null | false;

export interface ElementOptions {
  attrs?: Record<string, string | undefined>;
  keepEmpty?: boolean;
}

/* eslint-disable no-control-regex */
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
/* eslint-enable no-control-regex */

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toAttrs(attrs: Record<string, string | undefined> | undefined): ReadonlyArray<readonly [string, string]> {
  if (attrs === undefined) return [];
  const out: (readonly [string, string])[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) out.push([k, v]);
  }
  return out;
}

/** Container element. `undefined`/`null`/`false` in the child list are ignored. */
export function el(name: string, children: readonly XmlChild[], options: ElementOptions = {}): XmlElement {
  return {
    name,
    attrs: toAttrs(options.attrs),
    children: children.filter((c): c is XmlElement => c !== undefined && c !== null && c !== false),
    text: undefined,
    keepEmpty: options.keepEmpty === true,
  };
}

/** Text element; `undefined` or an empty text -> the element is dropped. */
export function text(name: string, value: string | undefined, attrs?: Record<string, string | undefined>): XmlElement | undefined {
  if (value === undefined || value === '') return undefined;
  return { name, attrs: toAttrs(attrs), children: [], text: value, keepEmpty: false };
}

/** Empty = no text and no children that would be written. */
function isEmpty(e: XmlElement): boolean {
  return e.text === undefined && e.children.every((c) => !c.keepEmpty && isEmpty(c));
}

function renderAttrs(attrs: ReadonlyArray<readonly [string, string]>): string {
  return attrs.map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('');
}

function renderElement(e: XmlElement, depth: number, out: string[]): void {
  if (!e.keepEmpty && isEmpty(e)) return;
  const pad = '  '.repeat(depth);
  const attrs = renderAttrs(e.attrs);
  if (e.text !== undefined) {
    out.push(`${pad}<${e.name}${attrs}>${escapeXml(e.text)}</${e.name}>`);
    return;
  }
  if (isEmpty(e)) {
    out.push(`${pad}<${e.name}${attrs}/>`);
    return;
  }
  out.push(`${pad}<${e.name}${attrs}>`);
  for (const c of e.children) renderElement(c, depth + 1, out);
  out.push(`${pad}</${e.name}>`);
}

/** Serializes the document; `namespaces` (prefix -> URI) end up as xmlns attributes on the root element. */
export function render(root: XmlElement, namespaces: Readonly<Record<string, string>>): string {
  const xmlns = Object.entries(namespaces).map(([p, uri]) => [`xmlns:${p}`, uri] as const);
  const rootWithNs: XmlElement = { ...root, attrs: [...xmlns, ...root.attrs], keepEmpty: true };
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  renderElement(rootWithNs, 0, out);
  return out.join('\n') + '\n';
}
