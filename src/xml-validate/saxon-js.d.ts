/**
 * Minimal type declaration for `saxon-js` 2.x (the package ships no types).
 * Only the surface used here: transform (async), XPath.evaluate, serialize, getResource.
 */
declare module 'saxon-js' {
  export interface TransformOptions {
    /** Already-parsed SEF (JSON object). Reused across multiple calls. */
    stylesheetInternal?: object;
    stylesheetFileName?: string;
    stylesheetBaseURI?: string;
    sourceText?: string;
    sourceFileName?: string;
    sourceNode?: unknown;
    destination?: 'document' | 'serialized' | 'raw' | 'application' | 'file' | 'stdout' | 'replaceBody' | 'appendToBody' | 'prependToBody';
    stylesheetParams?: Record<string, unknown>;
    documentPool?: Record<string, unknown>;
  }

  export interface TransformResult {
    principalResult: unknown;
  }

  export interface XPathOptions {
    namespaceContext?: Record<string, string>;
    resultForm?: 'default' | 'array' | 'iterator' | 'xdm';
    params?: Record<string, unknown>;
  }

  /** Node of SaxonJS's own DOM (subset). */
  export interface SaxonNode {
    localName: string;
    nodeName: string;
    namespaceURI: string | null;
    textContent: string | null;
    getAttribute(name: string): string | null;
  }

  export function transform(options: TransformOptions, execution: 'async'): Promise<TransformResult>;
  export function transform(options: TransformOptions, execution?: 'sync'): TransformResult;

  export const XPath: {
    evaluate(xpath: string, contextItem?: unknown, options?: XPathOptions): unknown;
  };

  export function serialize(value: unknown, options?: Record<string, unknown>): string;

  export function getResource(options: { text?: string; location?: string; file?: string; type: 'xml' | 'json' | 'text'; encoding?: string }): Promise<unknown>;

  const SaxonJS: {
    transform: typeof transform;
    XPath: typeof XPath;
    serialize: typeof serialize;
    getResource: typeof getResource;
  };
  export default SaxonJS;
}
