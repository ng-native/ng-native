import type { EngineNode } from '@ng-native/fabric';
import { domError, required } from './dom-error.ts';
import { engineOf } from './window.ts';

/**
 * `classList`, as the DOM's `DOMTokenList` has it: the element's classes by their place, as
 * `list[0]` and `item(0)`, its `value` read and written, and each class it is handed checked
 * before any of them is put in or taken out.
 *
 * And the class attribute as it was written, spaces and repeats and all, which the engine's set
 * of classes is not: read back as written for as long as the set is still what it says.
 */

/** The class attribute of each element, as it was last written by a script. */
const written = new WeakMap<EngineNode, string>();

const ASCII_SPACE = /[\t\n\f\r ]+/;
const sameClasses = (node: EngineNode, value: string): boolean => {
  const names = value.split(ASCII_SPACE).filter(Boolean);
  const classes = [...(node.classes ?? [])];
  return (
    new Set(names).size === classes.length &&
    [...new Set(names)].every((name, at) => name === classes[at])
  );
};

/** The class attribute: as written where the classes are still those, else the classes. */
export function classAttribute(node: EngineNode): string | null {
  const value = written.get(node);
  if (value !== undefined && sameClasses(node, value)) return value;
  return node.classes ? [...node.classes].join(' ') : null;
}

/** Write the class attribute, or take it away with `null`. */
export function setClassAttribute(node: EngineNode, value: string | null): void {
  if (value === null) written.delete(node);
  else written.set(node, value);
  engineOf(node).setClasses(node, value ?? '');
}

/** A class a list is given, which is one word: none at all and one with a space are refused. */
export function token(given: unknown): string {
  const name = String(given);
  if (name === '') throw domError('The token provided must not be empty.', 'SyntaxError');
  if (/[\t\n\f\r ]/.test(name)) {
    throw domError(`The token '${name}' contains a space.`, 'InvalidCharacterError');
  }
  return name;
}

const classesOf = (node: EngineNode): string[] => [...(node.classes ?? [])];

/** Write the classes, where there is a class attribute or there will be one. */
function write(node: EngineNode, names: readonly string[]): void {
  if (classAttribute(node) === null && names.length === 0) return;
  setClassAttribute(node, names.join(' '));
}

/** Where a list keeps its element: a key no script writes, and one a proxy passes through. */
const NODE = Symbol('node');

/** The list's methods, on its prototype: a list is made for each element, once. */
class ClassList {
  readonly [NODE]: EngineNode;

  constructor(node: EngineNode) {
    this[NODE] = node;
  }

  get length(): number {
    return this[NODE].classes?.size ?? 0;
  }

  // The class attribute as it is written, which a library splits to look for one of its own.
  get value(): string {
    return classAttribute(this[NODE]) ?? '';
  }

  set value(value: string) {
    setClassAttribute(this[NODE], String(value));
  }

  item(index: unknown): string | null {
    return classesOf(this[NODE])[Number(index)] ?? null;
  }

  contains(name: unknown): boolean {
    return !!this[NODE].classes?.has(String(name));
  }

  add(...names: unknown[]): void {
    const adding = names.map(token);
    write(this[NODE], [...new Set([...classesOf(this[NODE]), ...adding])]);
  }

  remove(...names: unknown[]): void {
    const removing = new Set(names.map(token));
    write(
      this[NODE],
      classesOf(this[NODE]).filter((name) => !removing.has(name)),
    );
  }

  toggle(...args: unknown[]): boolean {
    required(args, 1, 'toggle');
    const name = token(args[0]);
    const force = args[1] === undefined ? undefined : !!args[1];
    const has = this.contains(name);
    if (has === (force ?? !has)) return has;
    if (has) this.remove(name);
    else this.add(name);
    return !has;
  }

  replace(...args: unknown[]): boolean {
    required(args, 2, 'replace');
    // No class at all is refused before one with a space, of either.
    if (args[0] === '' || args[1] === '') token('');
    const old = token(args[0]);
    const next = token(args[1]);
    if (!this.contains(old)) return false;
    const names = classesOf(this[NODE]).map((name) => (name === old ? next : name));
    write(this[NODE], [...new Set(names)]);
    return true;
  }

  supports(): never {
    throw new TypeError('The class list has no supported tokens.');
  }

  toString(): string {
    return this.value;
  }

  keys(): IterableIterator<number> {
    return classesOf(this[NODE]).keys();
  }

  values(): IterableIterator<string> {
    return classesOf(this[NODE]).values();
  }

  entries(): IterableIterator<[number, string]> {
    return classesOf(this[NODE]).entries();
  }

  forEach(each: (name: string, index: number, list: ClassList) => void, self?: unknown): void {
    classesOf(this[NODE]).forEach((name, index) => each.call(self, name, index, this));
  }

  [Symbol.iterator](): IterableIterator<string> {
    return this.values();
  }
}

const indexed = /^(?:0|[1-9]\d*)$/;

/** Each element's list, the same one each time it is asked for, as a browser's is. */
const lists = new WeakMap<EngineNode, ClassList>();

/** The list of an element's classes, read by place as well: `list[0]`. */
export function classListOf(node: EngineNode): ClassList {
  let list = lists.get(node);
  if (!list) {
    list = new Proxy(new ClassList(node), {
      get: (target, key, receiver) =>
        typeof key === 'string' && indexed.test(key)
          ? (target.item(key) ?? undefined)
          : Reflect.get(target, key, receiver),
      has: (target, key) =>
        typeof key === 'string' && indexed.test(key)
          ? Number(key) < target.length
          : Reflect.has(target, key),
    });
    lists.set(node, list);
  }
  return list;
}
