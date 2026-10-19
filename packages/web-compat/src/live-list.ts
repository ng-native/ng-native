import type { Engine, EngineNode } from '@ng-native/fabric';

/**
 * `HTMLCollection` and `NodeList` as the DOM has them: live, so a list a library keeps sees what
 * is put in and taken out after it asked, with `item`, `length`, iteration, and an element by
 * its index or, in an `HTMLCollection`, by its id or name.
 *
 * What is in a list is worked out when it is read and kept until the tree changes: each engine
 * has a count of the changes to it, which the insert, remove, class and `name` calls below add
 * to, and a list read again with the count as it was answers what it found the last time. A
 * loop over a list of a large page walks the page once, not once an index.
 *
 * ponytail: one count for the whole engine, so a change anywhere has every list worked out again
 * when it is next read. Count by subtree if a page that changes all the time is seen to pay for it.
 */

const XHTML = 'http://www.w3.org/1999/xhtml';

/** The changes made to each engine's tree so far, and to the classes on it. */
const changes = new WeakMap<Engine, { count: number }>();

/** What changes what a list of nodes holds: a node put in or taken out, a class on one. */
const CHANGING = [
  'appendChild',
  'insertBefore',
  'removeChild',
  'setClasses',
  'addClass',
  'removeClass',
];

/**
 * The count of an engine's changes, kept from the first time it is asked for. A `name` set or
 * taken off is one too, by a script or a template's binding: a list is found by it.
 */
function changesOf(engine: Engine): { count: number } {
  const known = changes.get(engine);
  if (known) return known;
  const counted = { count: 0 };
  changes.set(engine, counted);
  const methods = engine as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of CHANGING) {
    const original = methods[name]!;
    methods[name] = function (this: unknown, ...args: unknown[]) {
      counted.count++;
      return original.apply(this, args);
    };
  }
  const { setProp } = engine;
  engine.setProp = function (node, key, value) {
    if (key === 'name') counted.count++;
    setProp.call(this, node, key, value);
  };
  return counted;
}

interface List {
  readonly find: () => EngineNode[];
  readonly changes: { count: number };
  seen: number;
  found: EngineNode[];
}

/** Each list's state, by the list as a script holds it and by what stands behind that. */
const lists = new WeakMap<object, List>();

function listOf(list: unknown): List {
  const state = lists.get(list as object);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}

/** What a list holds now: what it found the last time, where the tree has not changed since. */
function itemsOf(list: unknown): EngineNode[] {
  const state = listOf(list);
  if (state.seen !== state.changes.count) {
    state.found = state.find();
    state.seen = state.changes.count;
  }
  return state.found;
}

const illegal = (): never => {
  throw new TypeError('Illegal constructor');
};

/** The element an `HTMLCollection` has by a name: the first whose id is it, or whose name is. */
function named(items: readonly EngineNode[], name: string): EngineNode | null {
  if (name === '') return null;
  return (
    items.find(
      (node) => node.props['nativeID'] === name || (isHtml(node) && node.props['name'] === name),
    ) ?? null
  );
}

/**
 * Whether an element is one of HTML's, which is named by its `name` as well as its id: any that
 * says no namespace of its own is.
 */
export const isHtml = (node: EngineNode): boolean =>
  ((node as unknown as { namespaceURI?: string }).namespaceURI ?? XHTML) === XHTML;

/** Every id and name of what an `HTMLCollection` holds, once each, in order. */
function namesIn(items: readonly EngineNode[]): string[] {
  const names = new Set<string>();
  for (const node of items) {
    const id = node.props['nativeID'];
    if (typeof id === 'string' && id) names.add(id);
    const name = node.props['name'];
    if (isHtml(node) && typeof name === 'string' && name) names.add(name);
  }
  return [...names];
}

export class HTMLCollection {
  constructor() {
    illegal();
  }
  get length(): number {
    return itemsOf(this).length;
  }
  item(index: number): EngineNode | null {
    return itemsOf(this)[index >>> 0] ?? null;
  }
  namedItem(name: string): EngineNode | null {
    return named(itemsOf(this), String(name));
  }
}
Object.defineProperty(HTMLCollection.prototype, Symbol.iterator, {
  value: Array.prototype[Symbol.iterator],
  writable: true,
  configurable: true,
});

export class NodeList {
  constructor() {
    illegal();
  }
  get length(): number {
    return itemsOf(this).length;
  }
  item(index: number): EngineNode | null {
    return itemsOf(this)[index >>> 0] ?? null;
  }
  forEach(each: (node: EngineNode, index: number, list: NodeList) => void, self?: unknown): void {
    const items = itemsOf(this);
    for (let at = 0; at < items.length; at++) each.call(self, items[at]!, at, this);
  }
}
// Each says what it is, as `Object.prototype.toString` writes one: `[object NodeList]`.
for (const each of [HTMLCollection, NodeList]) {
  Object.defineProperty(each.prototype, Symbol.toStringTag, {
    value: each.name,
    configurable: true,
  });
}
for (const name of ['entries', 'keys', 'values'] as const) {
  Object.defineProperty(NodeList.prototype, name, {
    value: Array.prototype[name],
    writable: true,
    configurable: true,
  });
}
Object.defineProperty(NodeList.prototype, Symbol.iterator, {
  value: Array.prototype[Symbol.iterator],
  writable: true,
  configurable: true,
});

/** The index a key is, where it is one: `'0'` is, `'01'` and `'-1'` are not. */
function indexOf(key: string | symbol): number | undefined {
  if (typeof key !== 'string') return undefined;
  const index = Number(key);
  return String(index >>> 0) === key && index !== 2 ** 32 - 1 ? index : undefined;
}

/**
 * The traps of a list: an index is what is at it, and nothing past the end; in an
 * `HTMLCollection`, a name is the element of it where nothing else has that name. An index
 * cannot be set, nor a name an element has; anything else can, as on any object.
 */
function traps(byName: boolean): ProxyHandler<object> {
  /** The element a name stands for, where nothing of the list's own or its kind's has it. */
  const namedHere = (target: object, key: string | symbol): EngineNode | null => {
    if (!byName || typeof key !== 'string' || Object.hasOwn(target, key) || key in target) {
      return null;
    }
    return named(itemsOf(target), key);
  };
  const descriptor = (value: unknown, enumerable: boolean): PropertyDescriptor => ({
    value,
    writable: false,
    enumerable,
    configurable: true,
  });
  return {
    get(target, key, receiver) {
      const index = indexOf(key);
      if (index !== undefined) return itemsOf(target)[index];
      return namedHere(target, key) ?? Reflect.get(target, key, receiver);
    },
    has(target, key) {
      const index = indexOf(key);
      if (index !== undefined) return index < itemsOf(target).length;
      return Reflect.has(target, key) || !!namedHere(target, key);
    },
    getOwnPropertyDescriptor(target, key) {
      const index = indexOf(key);
      if (index !== undefined) {
        const node = itemsOf(target)[index];
        return node ? descriptor(node, true) : undefined;
      }
      const node = namedHere(target, key);
      return node ? descriptor(node, false) : Reflect.getOwnPropertyDescriptor(target, key);
    },
    defineProperty(target, key, property) {
      if (indexOf(key) !== undefined || namedHere(target, key)) return false;
      return Reflect.defineProperty(target, key, property);
    },
    set(target, key, value, receiver) {
      if (indexOf(key) !== undefined || namedHere(target, key)) return false;
      return Reflect.set(target, key, value, receiver === undefined ? target : receiver);
    },
    deleteProperty(target, key) {
      const index = indexOf(key);
      if (index !== undefined) return index >= itemsOf(target).length;
      if (namedHere(target, key)) return false;
      return Reflect.deleteProperty(target, key);
    },
    ownKeys(target) {
      const items = itemsOf(target);
      // A name that is an index is not one of its keys, as a browser has it: the index is.
      const names = byName
        ? namesIn(items).filter((name) => indexOf(name) === undefined && !(name in target))
        : [];
      return [...items.keys()].map(String).concat(names, Reflect.ownKeys(target) as string[]);
    },
  };
}

const COLLECTION = traps(true);
const NODE_LIST = traps(false);

function live(
  kind: object,
  handler: ProxyHandler<object>,
  engine: Engine,
  find: () => EngineNode[],
) {
  const target = Object.create(kind) as object;
  const list = new Proxy(target, handler);
  const state: List = { find, changes: changesOf(engine), seen: -1, found: [] };
  lists.set(target, state);
  lists.set(list, state);
  return list;
}

/** A live `HTMLCollection` of what `find` answers, worked out again once the tree has changed. */
export const liveCollection = (engine: Engine, find: () => EngineNode[]): HTMLCollection =>
  live(HTMLCollection.prototype, COLLECTION, engine, find) as HTMLCollection;

/** A live `NodeList` of what `find` answers, worked out again once the tree has changed. */
export const liveNodeList = (engine: Engine, find: () => EngineNode[]): NodeList =>
  live(NodeList.prototype, NODE_LIST, engine, find) as NodeList;
