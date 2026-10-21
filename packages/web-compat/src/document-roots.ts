import type { EngineNode } from '@ng-native/fabric';

/**
 * The nodes at the top of a tree that are in a document all the same: the engine's root, which
 * is the page's element, and a comment a script put in the document beside it. The engine has
 * no node for a document, so each is noted here with the document it is in: see
 * `document-children.ts`.
 */
const roots = new WeakMap<EngineNode, object>();

export const markRoot = (node: EngineNode, document: object): void =>
  void roots.set(node, document);
export const unmarkRoot = (node: EngineNode): void => void roots.delete(node);

/** The document whose tree a node is the top of, which is its parent in the DOM. */
export const documentOfRoot = (node: EngineNode): object | undefined => roots.get(node);

/** The top of the tree a node is in: itself where it is in nothing. */
export function topOf(node: EngineNode): EngineNode {
  let at = node;
  while (at.parent) at = at.parent;
  return at;
}
