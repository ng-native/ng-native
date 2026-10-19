import type { EngineNode } from '@ng-native/fabric';
import { KEPT } from './svg-filter.ts';

/** The nodes a drawing keeps of its own that are named as a script's are: a canvas's group. */
export const keptOwn = new WeakSet<EngineNode>();

/**
 * What a node holds as a browser's document has it: without the boxes a rule generated, its
 * `::before` and `::after`, which the engine keeps among its children and a browser nowhere, nor
 * a node a drawing keeps of its own: see `KEPT` in `svg-filter.ts`, and `keptOwn`.
 */
export const isInDocument = (child: EngineNode): boolean =>
  child.nodeKind !== 'element' ||
  !(child.tag.startsWith('::') || child.tag.startsWith(KEPT) || keptOwn.has(child));

export const inDocument = (node: EngineNode): EngineNode[] => node.childList.filter(isInDocument);

/** The last node `node` holds as a browser's document has it, found without copying the list. */
export function lastInDocument(node: EngineNode): EngineNode | undefined {
  const list = node.childList;
  for (let i = list.length - 1; i >= 0; i--) if (isInDocument(list[i]!)) return list[i];
  return undefined;
}

/** Every node under `node`, in document order, walked without recursion. */
export function* descendants(node: EngineNode): Generator<EngineNode> {
  const stack: EngineNode[] = [];
  for (let i = node.childList.length - 1; i >= 0; i--) stack.push(node.childList[i]!);
  while (stack.length) {
    const at = stack.pop()!;
    if (!isInDocument(at)) continue;
    yield at;
    for (let i = at.childList.length - 1; i >= 0; i--) stack.push(at.childList[i]!);
  }
}
