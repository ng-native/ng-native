import type { EngineNode } from '@ng-native/fabric';

/**
 * `Text`, `Comment`, `CharacterData` and `DocumentFragment` as globals: what a library asks
 * whether a node is one of, with `instanceof`, and makes one with, with `new`. A node is made in
 * the document of the newest app up, as the global `document` is that app's.
 */

interface Maker {
  createTextNode(data: string): EngineNode;
  createComment(data: string): EngineNode;
  createDocumentFragment(): EngineNode;
}

/**
 * What `Node` tells a node by, which the engine marks its own with: a document and a doctype are
 * nodes too, and are marked with it here.
 */
export const NODE_BRAND = Symbol.for('ng-native.node');

/** Mark an object a node, for `instanceof Node`. */
export const brandNode = <T extends object>(value: T): T =>
  Object.defineProperty(value, NODE_BRAND, { value: true });

/** Whether a value is a node of any kind: the engine's, a document or a doctype. */
export const isAnyNode = (value: unknown): boolean =>
  !!value && typeof value === 'object' && (value as Record<symbol, unknown>)[NODE_BRAND] === true;

const kindOf = (value: unknown): unknown => (value as { nodeKind?: unknown } | null)?.nodeKind;
const nodeTypeOf = (value: unknown): unknown => (value as { nodeType?: unknown } | null)?.nodeType;

function page(made: string): Maker {
  const document = (globalThis as unknown as { document?: Maker }).document;
  if (!document) throw new TypeError(`No document to make a ${made} in.`);
  return document;
}

/** A constructor `instanceof` asks `is` of, and `new` calls `make` for. */
function nodeInterface(
  name: string,
  is: (value: unknown) => boolean,
  make?: (data: string) => EngineNode,
) {
  const named = {
    [name]: function (this: unknown, data?: unknown) {
      if (!new.target || !make) throw new TypeError(`Illegal constructor: ${name}`);
      return make(data === undefined ? '' : String(data));
    },
  }[name]!;
  Object.defineProperty(named, Symbol.hasInstance, { value: is });
  return named;
}

export const nodeInterfaces: Readonly<Record<string, unknown>> = {
  CharacterData: nodeInterface('CharacterData', (value) => {
    const kind = kindOf(value);
    return kind === 'text' || kind === 'anchor';
  }),
  Text: nodeInterface(
    'Text',
    (value) => kindOf(value) === 'text',
    (data) => page('Text').createTextNode(data),
  ),
  // A comment is an anchor: one Angular makes is a comment as well, which a mutation's are.
  Comment: nodeInterface(
    'Comment',
    (value) => kindOf(value) === 'anchor' && nodeTypeOf(value) === 8,
    (data) => page('Comment').createComment(data),
  ),
  DocumentFragment: nodeInterface(
    'DocumentFragment',
    (value) => nodeTypeOf(value) === 11,
    () => page('DocumentFragment').createDocumentFragment(),
  ),
};
