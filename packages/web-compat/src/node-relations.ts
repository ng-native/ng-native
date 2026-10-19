import type { EngineNode } from '@ng-native/fabric';
import { documentOfRoot } from './document-roots.ts';
import { inDocument } from './in-document.ts';
import { isAnyNode } from './node-interfaces.ts';
import { isNode } from './pre-insertion.ts';
import { engineOf } from './window.ts';

/**
 * How one node stands to another, and to what it holds: `compareDocumentPosition`, which a
 * library sorts what registers with it by; `isEqualNode`; `normalize`; and the counts and ends
 * of what an element holds.
 */
type Dom = EngineNode & {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly localName: string | null;
  getAttribute(name: string): string | null;
};

const DISCONNECTED = 1;
const PRECEDING = 2;
const FOLLOWING = 4;
const CONTAINS = 8;
const CONTAINED_BY = 16;
const IMPLEMENTATION_SPECIFIC = 32;

/**
 * What a node is in: an engine node's parent, or the document it is at the top of, the page's
 * for the root; a doctype's document; nothing for a document.
 */
function parentOf(node: object): object | null {
  if (!isNode(node)) return (node as { parentNode?: object | null }).parentNode ?? null;
  return node.parent ?? documentOfRoot(node) ?? null;
}

/** What a node holds, in order: the page's document its doctype and its element. */
function childrenOf(node: object): unknown[] {
  if (isNode(node)) return node.childList;
  const held = (node as { childNodes?: ArrayLike<unknown> }).childNodes;
  return held ? Array.from(held) : [];
}

/** A node and every node it is in, itself first. */
function upFrom(node: object): object[] {
  const chain: object[] = [];
  for (let at: object | null = node; at; at = parentOf(at)) chain.push(at);
  return chain;
}

/** An order for trees that are apart, the same each time it is asked, as the DOM wants one. */
const apart = new WeakMap<object, number>();
let made = 0;
const orderOf = (root: object): number => apart.get(root) ?? (apart.set(root, ++made), made);

function disconnected(mine: object, theirs: object): number {
  const before = orderOf(theirs) < orderOf(mine);
  return DISCONNECTED | IMPLEMENTATION_SPECIFIC | (before ? PRECEDING : FOLLOWING);
}

/**
 * Where `other` is from `node`: before, after, around it or in it, or in another tree. Any node:
 * a document and a doctype as well as the engine's.
 */
export function position(node: object, other: object): number {
  if (node === other) return 0;
  const mine = upFrom(node);
  const theirs = upFrom(other);
  if (mine.at(-1) !== theirs.at(-1)) return disconnected(mine.at(-1)!, theirs.at(-1)!);
  if (mine.includes(other)) return CONTAINS | PRECEDING;
  if (theirs.includes(node)) return CONTAINED_BY | FOLLOWING;
  // Down from the top together, to where the two ways part: whichever comes first there.
  let at = 1;
  while (mine.at(-1 - at) === theirs.at(-1 - at)) at++;
  const children = childrenOf(mine.at(-at)!);
  const order = children.indexOf(theirs.at(-1 - at)!) - children.indexOf(mine.at(-1 - at)!);
  return order < 0 ? PRECEDING : FOLLOWING;
}

/** The node `compareDocumentPosition` is handed: what is none is a `TypeError`. */
export function nodeGiven(value: unknown): object {
  if (!isAnyNode(value)) {
    throw new TypeError("Failed to execute 'compareDocumentPosition': the value is not a Node.");
  }
  return value as object;
}

/** Whether `other` is `node` or in it, for any node. */
export function containsNode(node: object, other: unknown): boolean {
  if (!isAnyNode(other)) return false;
  for (let at: object | null = other as object; at; at = parentOf(at)) if (at === node) return true;
  return false;
}

/**
 * An element's attributes as `getAttribute` reads them, by the name each is kept as.
 *
 * ponytail: every prop is taken for an attribute, the engine's own among them. Read the names
 * `getAttributeNames` gives once nodes have it.
 */
function attributesOf(node: Dom): Map<string, string> {
  const all = new Map<string, string>();
  for (const name of ['class', ...Object.keys(node.props)]) {
    const key = name === 'nativeID' ? 'id' : name;
    const value = node.getAttribute(key);
    if (value !== null) all.set(key, value);
  }
  return all;
}

function sameAttributes(one: Dom, other: Dom): boolean {
  const mine = attributesOf(one);
  const theirs = attributesOf(other);
  if (mine.size !== theirs.size) return false;
  for (const [name, value] of mine) if (theirs.get(name) !== value) return false;
  return true;
}

/** Whether two nodes are alike: of a kind and a name, with the same text, attributes and children. */
function equal(one: Dom, other: Dom): boolean {
  if (one.nodeType !== other.nodeType || one.nodeName !== other.nodeName) return false;
  // A text's words, and a comment's.
  if (one.nodeKind !== 'element' && one.nodeText !== other.nodeText) return false;
  if (one.nodeKind === 'element' && !sameAttributes(one, other)) return false;
  const mine = inDocument(one);
  const theirs = inDocument(other);
  return (
    mine.length === theirs.length &&
    mine.every((child, at) => equal(child as Dom, theirs[at] as Dom))
  );
}

/** No empty text, and no two texts side by side, anywhere under a node. */
function normalize(node: EngineNode): void {
  const engine = engineOf(node);
  let text: EngineNode | null = null;
  for (const child of [...node.childList]) {
    if (child.nodeKind !== 'text') {
      text = null;
      if (child.nodeKind === 'element') normalize(child);
    } else if (child.nodeText === '') engine.removeChild(node, child);
    else if (text) {
      engine.setText(text, text.nodeText + child.nodeText);
      engine.removeChild(node, child);
    } else text = child;
  }
}

const elementsIn = (node: EngineNode): EngineNode[] =>
  inDocument(node).filter((child) => child.nodeKind === 'element');

const method = (value: (this: Dom, ...args: never[]) => unknown) => ({ value, writable: true });
const get = (read: (this: Dom) => unknown) => ({ get: read });

/** The members above, for every node. */
export const relationMembers: PropertyDescriptorMap = {
  compareDocumentPosition: method(function (other: unknown) {
    return position(this, nodeGiven(other));
  }),
  isEqualNode: method(function (other: unknown) {
    return isNode(other) && equal(this, other as Dom);
  }),
  isSameNode: method(function (other: unknown) {
    return other === this;
  }),
  normalize: method(function () {
    normalize(this);
  }),
  hasChildNodes: method(function () {
    return inDocument(this).length > 0;
  }),
  childElementCount: get(function () {
    return elementsIn(this).length;
  }),
  lastElementChild: get(function () {
    return elementsIn(this).at(-1) ?? null;
  }),
};
