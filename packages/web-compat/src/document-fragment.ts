import type { EngineNode } from '@ng-native/fabric';
import { inDocument } from './in-document.ts';

/**
 * `document.createDocumentFragment`: a box a library fills and then puts in the page whole, as
 * what it holds. Put anywhere, it is its children that go there, and it is left empty: a view
 * of its own in the page would be a box the layout has that a browser's has not.
 */
const fragments = new WeakSet<EngineNode>();

export function markFragment(node: EngineNode): EngineNode {
  fragments.add(node);
  return node;
}

export const isFragment = (node: EngineNode): boolean => fragments.has(node);

/** What goes in where a node is put: a fragment's children, or the node itself. */
export const insertedFor = (node: EngineNode): EngineNode[] =>
  fragments.has(node) ? inDocument(node) : [node];
