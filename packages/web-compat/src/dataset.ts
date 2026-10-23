import type { EngineNode } from '@ng-native/fabric';
import { domError } from './dom-error.ts';

/**
 * `element.dataset`: the element's `data-*` attributes by camel-case name, read, set, deleted
 * and listed. A library keeps state on an element this way and styles by it: `data-state`.
 * Each read and write is of the attributes themselves, so the map is never out of date.
 */

type Attributed = EngineNode & {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  getAttributeNames(): string[];
};

/** The attribute a name is kept as: `fooBar` is `data-foo-bar`. */
const attributeOf = (name: string) =>
  `data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/** The name an attribute is read by, where it is a `data-*` one with such a name. */
function nameOf(attribute: string): string | undefined {
  if (!attribute.startsWith('data-') || /[A-Z]/.test(attribute)) return undefined;
  return attribute.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** Whether a name is one an attribute reads back as: none has a dash before a small letter. */
const isName = (name: string) => !/-[a-z]/.test(name);

/** A name to set by: one no attribute reads back as, or one no attribute can have, throws. */
function checked(name: string): string {
  if (!isName(name)) {
    throw domError(`'${name}' is not a valid name for a data attribute.`, 'SyntaxError');
  }
  if (/[\s\0"'>/=]/.test(name)) {
    throw domError(`'${name}' is not a valid attribute name.`, 'InvalidCharacterError');
  }
  return name;
}

/** The attribute a name is read by, where it is a name: none for one that is not. */
const readBy = (key: string | symbol) =>
  typeof key === 'string' && isName(key) ? attributeOf(key) : undefined;

/** What a `dataset` is an instance of. */
export class DOMStringMap {}

const maps = new WeakMap<EngineNode, object>();

/** An element's `dataset`, the one map for as long as the element is. */
export function datasetOf(node: Attributed): object {
  let map = maps.get(node);
  if (map) return map;
  const names = () => node.getAttributeNames().flatMap((each) => nameOf(each) ?? []);
  map = new Proxy(new DOMStringMap(), {
    get: (target, key, receiver) => {
      const attribute = readBy(key);
      return (attribute && node.getAttribute(attribute)) ?? Reflect.get(target, key, receiver);
    },
    set: (target, key, value) => {
      if (typeof key === 'symbol') return Reflect.set(target, key, value);
      node.setAttribute(attributeOf(checked(key)), String(value));
      return true;
    },
    has: (target, key) => {
      const attribute = readBy(key);
      return (!!attribute && node.hasAttribute(attribute)) || key in target;
    },
    deleteProperty: (target, key) => {
      if (typeof key === 'symbol') return Reflect.deleteProperty(target, key);
      const attribute = readBy(key);
      if (attribute) node.removeAttribute(attribute);
      return true;
    },
    ownKeys: () => names(),
    getOwnPropertyDescriptor: (_, key) => {
      const attribute = readBy(key);
      const value = attribute ? node.getAttribute(attribute) : null;
      return value === null
        ? undefined
        : { value, writable: true, enumerable: true, configurable: true };
    },
    defineProperty: (_, key, descriptor) => {
      if (typeof key === 'symbol' || !('value' in descriptor)) return false;
      node.setAttribute(attributeOf(checked(key)), String(descriptor.value));
      return true;
    },
  });
  maps.set(node, map);
  return map;
}
