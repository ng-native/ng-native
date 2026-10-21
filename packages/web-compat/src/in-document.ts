import type { EngineNode } from '@ng-native/fabric';
import { KEPT } from './svg-filter.ts';

/** Nodes a drawing keeps of its own and hides from a script, such as a canvas's group. */
export const keptOwn = new WeakSet<EngineNode>();

/**
 * Whether a script sees a node among its parent's children, as in a browser's document. It does
 * not see the `::before` and `::after` boxes a rule generates, which the engine keeps among the
 * children, nor a node a drawing keeps of its own: see `KEPT` in `svg-filter.ts`, and `keptOwn`.
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
