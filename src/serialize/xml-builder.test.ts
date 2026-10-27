import { describe, expect, it } from 'vitest';
import { el, escapeXml, render, text } from './xml-builder.js';

describe('escapeXml', () => {
  it('escapes & < > " \' and removes control characters not allowed in XML 1.0', () => {
    expect(escapeXml(`Müller & Söhne <GmbH> "Test" 'x'`)).toBe('Müller &amp; Söhne &lt;GmbH&gt; &quot;Test&quot; &apos;x&apos;');
    expect(escapeXml('a\u0000b\u0007c\td\ne')).toBe('abc\td\ne');
  });
});

describe('render', () => {
  it('writes the XML declaration, namespaces on the root element, 2-space indentation and single-line text elements', () => {
    const doc = el('rsm:Root', [el('ram:A', [text('ram:B', 'x'), text('ram:C', '1 < 2', { unitCode: 'C62' })])]);
    expect(render(doc, { rsm: 'urn:rsm', ram: 'urn:ram' })).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rsm:Root xmlns:rsm="urn:rsm" xmlns:ram="urn:ram">',
        '  <ram:A>',
        '    <ram:B>x</ram:B>',
        '    <ram:C unitCode="C62">1 &lt; 2</ram:C>',
        '  </ram:A>',
        '</rsm:Root>',
        '',
      ].join('\n'),
    );
  });

  it('omits elements without content (PEPPOL-EN16931-R008), even if they only have empty children', () => {
    const doc = el('r', [text('a', undefined), text('b', ''), el('c', [text('d', undefined)]), text('e', 'ok')]);
    expect(render(doc, {})).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<r>\n  <e>ok</e>\n</r>\n');
  });

  it('writes an empty element only with keepEmpty (XSD-mandatory element without content)', () => {
    const doc = el('r', [el('a', [], { keepEmpty: true }), el('b', [])]);
    expect(render(doc, {})).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<r>\n  <a/>\n</r>\n');
  });

  it('keeps the given order of the children and ignores undefined/null/false in child lists', () => {
    const doc = el('r', [text('z', '1'), undefined, null, false, text('a', '2')]);
    expect(render(doc, {})).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<r>\n  <z>1</z>\n  <a>2</a>\n</r>\n');
  });

  it('attributes with an undefined value are not written; attribute values are escaped', () => {
    const doc = el('r', [text('a', 'v', { x: undefined, y: 'a"b' })]);
    expect(render(doc, {})).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<r>\n  <a y="a&quot;b">v</a>\n</r>\n');
  });

  it('line breaks in text are preserved (notes, payment terms)', () => {
    const doc = el('r', [text('n', 'Zeile 1\nZeile 2')]);
    expect(render(doc, {})).toContain('<n>Zeile 1\nZeile 2</n>');
  });
});
