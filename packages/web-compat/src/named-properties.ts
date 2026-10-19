import type { Engine, EngineNode } from '@ng-native/fabric';
import { topOf } from './document-roots.ts';
import { liveCollection } from './live-list.ts';
import { headOf } from './document.ts';
import { currentEngine } from './window.ts';
import { renamings } from './renamings.ts';

/**
 * The window's named properties (https://html.spec.whatwg.org/#named-access-on-the-window-object):
 * an element with an id is a global of that name, `target` for `<div id="target">`, as is an
 * `<embed>`, `<form>`, `<img>` or `<object>` by its `name`. A script written for a page reads
 * one so. A global of the name, or one the runtime has, comes first.
 *
 * They are answered by an object put in the global's prototype chain, as a browser's
 * `WindowProperties` is: a name the global has is found before it is asked. Every other global a
 * script asks for is asked of it too, so what it found is kept: every name for the rest of the
 * task, until an id or a name is written. The engine is not watched for it, as nothing is until
 * something observes it.
 *
 * ponytail: an element put in with an id is a global by it from the next task, unless it is
 * written through the DOM.
 */

/** The elements named by their `name` as well as their id. */
const BY_NAME = new Set(['embed', 'form', 'img', 'object']);

const isNamed = (node: EngineNode, name: string): boolean =>
  node.props['nativeID'] === name || (BY_NAME.has(node.tag) && node.props['name'] === name);

/** The names an element is a global by: its id, and its `name` where that names it too. */
function namesOf(node: EngineNode): string[] {
  const id = node.props['nativeID'];
  const name = BY_NAME.has(node.tag) ? node.props['name'] : undefined;
  return [id, name].filter((each): each is string => typeof each === 'string' && each !== '');
}

/** Every element under a node by each name it is a global by, in the order of the page. */
function index(node: EngineNode, into: Map<string, EngineNode[]>): Map<string, EngineNode[]> {
  for (const child of node.childList) {
    if (child.nodeKind !== 'element') continue;
    for (const name of new Set(namesOf(child))) {
      const list = into.get(name);
      if (list) list.push(child);
      else into.set(name, [child]);
    }
    index(child, into);
  }
  return into;
}

/**
 * The trees of a document: the head and then the page, as it searches them. A head put in the
 * page is searched with it, so each element in it is named once.
 */
const trees = (engine: Engine): EngineNode[] => {
  const head = headOf(engine);
  return head && topOf(head) !== engine.root ? [head, engine.root] : [engine.root];
};

/** Whether a node is in the document, in its head or the page. */
const inPage = (node: EngineNode, engine: Engine): boolean => trees(engine).includes(topOf(node));

/**
 * What each engine's page was last found to name: every name as the page was until the task that
 * found them ends, or an id or a name is written.
 */
interface Found {
  all: Map<string, EngineNode[]> | undefined;
  renamed: number;
}
const found = new WeakMap<Engine, Found>();

/** Every element by each name, kept for the rest of the task, as a loop asks again and again. */
function allNamed(engine: Engine, known: Found): Map<string, EngineNode[]> {
  if (known.all && known.renamed === renamings()) return known.all;
  const all = new Map<string, EngineNode[]>();
  for (const tree of trees(engine)) index(tree, all);
  known.all = all;
  known.renamed = renamings();
  queueMicrotask(() => {
    if (known.all === all) known.all = undefined;
  });
  return all;
}

/** The elements of the page a name names. */
function namedIn(name: string): EngineNode[] {
  const engine = currentEngine();
  if (!engine || !name) return [];
  const known =
    found.get(engine) ?? found.set(engine, { all: undefined, renamed: -1 }).get(engine)!;
  // Each still has the name, and is still in the page.
  return (allNamed(engine, known).get(name) ?? []).filter(
    (node) => isNamed(node, name) && inPage(node, engine),
  );
}

/** What a name reads: the one element it names, or every one where there are more. */
function namedValue(name: string): unknown {
  const all = namedIn(name);
  if (all.length < 2) return all[0];
  return liveCollection(currentEngine()!, () => namedIn(name));
}

/**
 * Put the named properties in the global's prototype chain, and answer what takes them out.
 * A runtime whose global's prototype cannot be set has none.
 */
export function installNamedProperties(target: object): () => void {
  const before = Object.getPrototypeOf(target) as object | null;
  if (!before) return () => {};
  const named = new Proxy(before, {
    has: (inner, key) =>
      Reflect.has(inner, key) || (typeof key === 'string' && namedIn(key).length > 0),
    get: (inner, key, receiver) =>
      typeof key !== 'string' || Reflect.has(inner, key)
        ? Reflect.get(inner, key, receiver)
        : namedValue(key),
  });
  try {
    Object.setPrototypeOf(target, named);
  } catch {
    return () => {};
  }
  return () => {
    if (Object.getPrototypeOf(target) === named) Object.setPrototypeOf(target, before);
  };
}
