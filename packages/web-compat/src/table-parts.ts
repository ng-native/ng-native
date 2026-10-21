import type { EngineNode } from '@ng-native/fabric';
import { own, type Reflecting, type Reflection } from './reflect.ts';
import { liveCollection, type HTMLCollection } from './live-list.ts';
import { inDocument } from './in-document.ts';
import { engineOf } from './window.ts';

/**
 * A table's parts as HTML's table elements answer them: a table's `rows`, `tBodies`, `tHead`,
 * `tFoot` and `caption`, a section's `rows` and a row's `cells`. Each list is live, the one list
 * for as long as the element is, as a browser keeps it.
 */

/** An element's HTML children of some names. */
const childrenNamed = (node: EngineNode, names: readonly string[]): EngineNode[] =>
  inDocument(node).filter(
    (child) =>
      child.nodeKind === 'element' &&
      names.includes((child as Reflecting & { localName?: string }).localName ?? child.tag),
  );

/** A table's rows: its head's, then its own and its bodies' in order, then its foot's. */
function rowsOf(table: EngineNode): EngineNode[] {
  const head = childrenNamed(table, ['thead']).flatMap((each) => childrenNamed(each, ['tr']));
  const foot = childrenNamed(table, ['tfoot']).flatMap((each) => childrenNamed(each, ['tr']));
  const middle = childrenNamed(table, ['tr', 'tbody']).flatMap((each) =>
    each.tag === 'tr' ? [each] : childrenNamed(each, ['tr']),
  );
  return [...head, ...middle, ...foot];
}

/** Each element's list of each name, made once. */
const lists = new WeakMap<EngineNode, Map<string, HTMLCollection>>();

function listOf(name: string, find: (node: EngineNode) => EngineNode[]): Reflection {
  return own((node) => {
    const mine = lists.get(node) ?? lists.set(node, new Map()).get(node)!;
    let list = mine.get(name);
    if (!list) mine.set(name, (list = liveCollection(engineOf(node), () => find(node))));
    return list;
  });
}

const first = (names: readonly string[]): Reflection =>
  own((node) => childrenNamed(node, names)[0] ?? null);

const SECTION = { rows: listOf('rows', (node) => childrenNamed(node, ['tr'])) };

export const TABLE_PARTS: Readonly<Record<string, Readonly<Record<string, Reflection>>>> = {
  table: {
    rows: listOf('rows', rowsOf),
    tBodies: listOf('tBodies', (node) => childrenNamed(node, ['tbody'])),
    tHead: first(['thead']),
    tFoot: first(['tfoot']),
    caption: first(['caption']),
  },
  thead: SECTION,
  tbody: SECTION,
  tfoot: SECTION,
  tr: { cells: listOf('cells', (node) => childrenNamed(node, ['td', 'th'])) },
};
