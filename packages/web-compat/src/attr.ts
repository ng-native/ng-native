import type { EngineNode } from '@ng-native/fabric';
import { domError, required } from './dom-error.ts';
import {
  asciiLower,
  attributeNameOf,
  checkAttributeName,
  extractName,
  noteAttributeName,
  XHTML,
  type QualifiedName,
} from './qualified-name.ts';
import { settingAttribute } from './mutation-observer.ts';

/**
 * Attributes as nodes, as the DOM's `Attr` has them: the same one each time an element is asked
 * for it, its value the element's, and its own again once it is taken off. The value is kept
 * where it always is, as the element's prop: an `Attr` is a way to it, and `attributes` a list
 * of them.
 */

type Element = EngineNode & {
  readonly namespaceURI: string | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  getAttributeNames(): string[];
};

const OWNER = Symbol('owner');
const NAME = Symbol('name');
const VALUE = Symbol('value');
const LIST = Symbol('list');

const qualifiedOf = (name: QualifiedName): string =>
  name.prefix === null ? name.localName : `${name.prefix}:${name.localName}`;

/** Each element's attributes as nodes, by qualified name, made as they are asked for. */
const made = new WeakMap<EngineNode, Map<string, Attr>>();

export class Attr {
  [OWNER]: Element | null = null;
  [NAME]: QualifiedName;
  [VALUE] = '';

  constructor(name: QualifiedName) {
    this[NAME] = name;
  }

  get name(): string {
    return qualifiedOf(this[NAME]);
  }
  get nodeName(): string {
    return this.name;
  }
  get localName(): string {
    return this[NAME].localName;
  }
  get prefix(): string | null {
    return this[NAME].prefix;
  }
  get namespaceURI(): string | null {
    return this[NAME].namespace;
  }
  get nodeType(): number {
    return 2;
  }
  get specified(): boolean {
    return true;
  }
  /** The element it is on: none once the element no longer has it, whatever took it off. */
  get ownerElement(): Element | null {
    const owner = this[OWNER];
    if (owner && !owner.getAttributeNames().includes(this.name)) detach(this, null);
    return this[OWNER];
  }
  /**
   * Its element's, or the page's where it is on none.
   *
   * ponytail: one a made document created is the page's too: an attribute keeps no document.
   */
  get baseURI(): string {
    const holder = (this.ownerElement ?? (globalThis as { document?: unknown }).document) as
      { baseURI?: unknown } | undefined;
    return typeof holder?.baseURI === 'string' ? holder.baseURI : 'about:blank';
  }
  get value(): string {
    const owner = this.ownerElement;
    return owner ? (owner.getAttribute(this.name) ?? '') : this[VALUE];
  }
  set value(value: string) {
    const owner = this.ownerElement;
    if (owner) owner.setAttribute(this.name, String(value));
    else this[VALUE] = String(value);
  }
  get nodeValue(): string {
    return this.value;
  }
  set nodeValue(value: string) {
    this.value = value === null ? '' : value;
  }
  get textContent(): string {
    return this.value;
  }
  set textContent(value: string) {
    this.value = value === null ? '' : value;
  }
}

/** An attribute taken off its element, which keeps the value it had. */
function detach(attr: Attr, value: string | null): void {
  const owner = attr[OWNER];
  if (!owner) return;
  attr[VALUE] = value ?? attr[VALUE];
  attr[OWNER] = null;
  made.get(owner)?.delete(attr.name);
}

/** An attribute is being taken off an element: its node keeps the value it had. */
export function attributeRemoved(element: EngineNode, name: string, value: string | null): void {
  const attr = made.get(element)?.get(name);
  if (attr) detach(attr, value);
}

/** The node of an attribute an element has, by the name it is kept by. */
function attrOf(element: Element, qualified: string): Attr {
  const attrs = made.get(element) ?? new Map<string, Attr>();
  made.set(element, attrs);
  let attr = attrs.get(qualified);
  if (!attr) {
    attr = new Attr(attributeNameOf(element, qualified));
    attr[OWNER] = element;
    attrs.set(qualified, attr);
  }
  return attr;
}

/** The name an element keeps an attribute by: the one given, or on an HTML element any case of it. */
function keptName(element: Element, name: string): string | undefined {
  const names = element.getAttributeNames();
  if (names.includes(name)) return name;
  if (element.namespaceURI !== XHTML) return undefined;
  const lower = asciiLower(name);
  return names.find((each) => asciiLower(each) === lower);
}

/** The name of an attribute in a namespace, by its local name. */
export function keptNameNS(
  element: Element,
  namespace: unknown,
  local: string,
): string | undefined {
  const space =
    namespace === undefined || namespace === null || namespace === '' ? null : String(namespace);
  return element.getAttributeNames().find((each) => {
    const name = attributeNameOf(element, each);
    return name.namespace === space && name.localName === local;
  });
}

export const getAttributeNode = (element: Element, name: unknown): Attr | null => {
  const kept = keptName(element, String(name));
  return kept === undefined ? null : attrOf(element, kept);
};

export const getAttributeNodeNS = (
  element: Element,
  namespace: unknown,
  local: unknown,
): Attr | null => {
  const kept = keptNameNS(element, namespace, String(local));
  return kept === undefined ? null : attrOf(element, kept);
};

/** `setAttributeNode`: an attribute put on an element, in the place of one of its names. */
export function setAttributeNode(element: Element, attr: unknown): Attr | null {
  if (!(attr instanceof Attr)) throw new TypeError('The attribute given is not an Attr.');
  const owner = attr.ownerElement;
  if (owner && owner !== element) {
    throw domError('The attribute is on another element.', 'InUseAttributeError');
  }
  const old = getAttributeNodeNS(element, attr.namespaceURI, attr.localName);
  if (old === attr) return attr;
  const value = attr.value;
  if (old) detach(old, old.value);
  settingAttribute(
    element,
    attr.name,
    () => element.setAttribute(attr.name, value),
    attr.namespaceURI,
  );
  noteAttributeName(element, attr.name, attr[NAME]);
  attr[OWNER] = element;
  const attrs = made.get(element) ?? new Map<string, Attr>();
  made.set(element, attrs.set(attr.name, attr));
  return old;
}

/** `removeAttributeNode`: one of the element's own attributes taken off it. */
export function removeAttributeNode(element: Element, attr: unknown): Attr {
  if (!(attr instanceof Attr) || attr.ownerElement !== element) {
    throw domError('The attribute is not on this element.', 'NotFoundError');
  }
  const value = attr.value;
  element.removeAttribute(attr.name);
  detach(attr, value);
  return attr;
}

/** `document.createAttribute`: an attribute on no element, its name lower case in HTML. */
export function createAttribute(...args: unknown[]): Attr {
  required(args, 1, 'createAttribute');
  const name = asciiLower(checkAttributeName(String(args[0])));
  return new Attr({ namespace: null, prefix: null, localName: name });
}

export function createAttributeNS(...args: unknown[]): Attr {
  required(args, 2, 'createAttributeNS');
  return new Attr(extractName(args[0], String(args[1]), 'attribute'));
}

/**
 * `attributes`: an element's attributes as a `NamedNodeMap`, each by its place and by its name.
 * Read afresh each time it is asked for.
 */
class NamedNodeMap {
  readonly [OWNER]: Element;
  readonly [LIST]: Attr[];

  constructor(element: Element, attrs: Attr[]) {
    this[OWNER] = element;
    this[LIST] = attrs;
    attrs.forEach((attr, at) => Object.defineProperty(this, at, { value: attr, enumerable: true }));
  }

  get length(): number {
    return this[LIST].length;
  }
  item(index: unknown): Attr | null {
    return this[LIST][Number(index)] ?? null;
  }
  getNamedItem(name: unknown): Attr | null {
    return getAttributeNode(this[OWNER], name);
  }
  getNamedItemNS(namespace: unknown, local: unknown): Attr | null {
    return getAttributeNodeNS(this[OWNER], namespace, local);
  }
  setNamedItem(attr: unknown): Attr | null {
    return setAttributeNode(this[OWNER], attr);
  }
  setNamedItemNS(attr: unknown): Attr | null {
    return setAttributeNode(this[OWNER], attr);
  }
  removeNamedItem(name: unknown): Attr {
    const attr = getAttributeNode(this[OWNER], name);
    if (!attr) throw domError(`No attribute '${String(name)}'.`, 'NotFoundError');
    return removeAttributeNode(this[OWNER], attr);
  }
  removeNamedItemNS(namespace: unknown, local: unknown): Attr {
    const attr = getAttributeNodeNS(this[OWNER], namespace, local);
    if (!attr) throw domError(`No attribute '${String(local)}'.`, 'NotFoundError');
    return removeAttributeNode(this[OWNER], attr);
  }
  [Symbol.iterator](): IterableIterator<Attr> {
    return this[LIST].values();
  }
}

/** Every attribute an element has, `class` among them where it has a class. */
export const attributesOf = (element: Element): NamedNodeMap =>
  new NamedNodeMap(
    element,
    element.getAttributeNames().map((name) => attrOf(element, name)),
  );
