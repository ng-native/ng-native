import type { EngineNode } from '@ng-native/fabric';
import { documentOfRoot } from './document-roots.ts';
import { inDocument } from './in-document.ts';
import { isAnyNode } from './node-interfaces.ts';
import { isNode } from './pre-insertion.ts';
import { attributeNameOf, attributeNamespace, XML, XMLNS } from './qualified-name.ts';
import { engineOf } from './window.ts';

/**
 * How one node stands to another, and to what it holds: `compareDocumentPosition`, which a
 * library sorts what registers with it by; `isEqualNode`; `normalize`; the namespace lookups;
 * and the counts and ends of what an element holds.
 */
type Dom = EngineNode & {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly localName: string | null;
  readonly namespaceURI: string | null;
  readonly prefix: string | null;
  getAttribute(name: string): string | null;
  getAttributeNames(): string[];
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

/** An element's attributes, by namespace and local name. */
function attributesOf(node: Dom): Map<string, string | null> {
  const all = new Map<string, string | null>();
  for (const name of node.getAttributeNames()) {
    const { namespace, localName } = attributeNameOf(node, name);
    all.set(`${namespace ?? ''} ${localName}`, node.getAttribute(name));
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

/** Whether two elements have the same names, and the same attributes. */
function sameElement(one: Dom, other: Dom): boolean {
  return (
    one.namespaceURI === other.namespaceURI &&
    one.prefix === other.prefix &&
    one.localName === other.localName &&
    sameAttributes(one, other)
  );
}

/** Whether two nodes are alike: of a kind and a name, with the same text, attributes and children. */
function equal(one: Dom, other: Dom): boolean {
  if (one.nodeType !== other.nodeType) return false;
  // An element by its names, below: its `nodeName` is upper case in an HTML document alone.
  if (one.nodeKind !== 'element' && one.nodeName !== other.nodeName) return false;
  // A text's words, a comment's and a processing instruction's.
  if (one.nodeKind !== 'element' && one.nodeText !== other.nodeText) return false;
  if (one.nodeKind === 'element' && !sameElement(one, other)) return false;
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

/** The element a node's namespaces are looked up from: itself, or the element it is in. */
function elementFor(node: Dom): Dom | null {
  if (node.nodeType === 1) return node;
  // A fragment has none, and a text or a comment has that of what it is in.
  if (node.nodeType !== 3 && node.nodeType !== 8 && node.nodeType !== 4 && node.nodeType !== 7) {
    return null;
  }
  return node.parent?.nodeKind === 'element' ? (node.parent as Dom) : null;
}

const elementAbove = (element: Dom): Dom | null =>
  element.parent?.nodeKind === 'element' ? (element.parent as Dom) : null;

/** The value of the `xmlns` or `xmlns:prefix` attribute written in the XMLNS namespace. */
function declared(element: Dom, prefix: string | null): string | null | undefined {
  const name = prefix === null ? 'xmlns' : `xmlns:${prefix}`;
  if (attributeNamespace(element, name) !== XMLNS) return undefined;
  return element.getAttribute(name) || null;
}

/** The DOM's "locate a namespace": what a prefix stands for at a node, `null` for none. */
function namespaceFor(node: Dom, prefix: string | null): string | null {
  let at = elementFor(node);
  if (!at) return null;
  if (prefix === 'xml') return XML;
  if (prefix === 'xmlns') return XMLNS;
  for (; at; at = elementAbove(at)) {
    if (at.namespaceURI !== null && at.prefix === prefix) return at.namespaceURI;
    const value = declared(at, prefix);
    if (value !== undefined) return value;
  }
  return null;
}

/** The DOM's "locate a namespace prefix": a prefix that stands for a namespace at a node. */
function prefixFor(node: Dom, namespace: string): string | null {
  for (let at = elementFor(node); at; at = elementAbove(at)) {
    if (at.namespaceURI === namespace && at.prefix !== null) return at.prefix;
    const element = at;
    const name = element
      .getAttributeNames()
      .find(
        (each) =>
          each.startsWith('xmlns:') &&
          attributeNamespace(element, each) === XMLNS &&
          element.getAttribute(each) === namespace,
      );
    if (name) return name.slice('xmlns:'.length);
  }
  return null;
}

/** A namespace or a prefix as these are given one: the empty string is none. */
const orNone = (value: unknown): string | null =>
  value === undefined || value === null || value === '' ? null : String(value);

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
  lookupNamespaceURI: method(function (prefix: unknown) {
    return namespaceFor(this, orNone(prefix));
  }),
  lookupPrefix: method(function (namespace: unknown) {
    const given = orNone(namespace);
    return given === null ? null : prefixFor(this, given);
  }),
  isDefaultNamespace: method(function (namespace: unknown) {
    return namespaceFor(this, null) === orNone(namespace);
  }),
  childElementCount: get(function () {
    return elementsIn(this).length;
  }),
  lastElementChild: get(function () {
    return elementsIn(this).at(-1) ?? null;
  }),
};
