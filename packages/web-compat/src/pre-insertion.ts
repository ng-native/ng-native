import type { EngineNode } from '@ng-native/fabric';
import { domError } from './dom-error.ts';

/**
 * What the DOM refuses to put in the tree or take out of it, as its "ensure pre-insertion
 * validity" and "pre-remove" steps have it, with the error a browser names: a library tells one
 * from another by the name, and an insertion the engine took would leave a node inside itself,
 * a tree with no top that every walk of it goes round for ever.
 */

/** Whether a value is one of the engine's nodes. */
export const isNode = (value: unknown): value is EngineNode =>
  !!value && typeof value === 'object' && 'nodeKind' in value && 'childList' in value;

const hierarchy = (message: string) => domError(message, 'HierarchyRequestError');

/** A document or a doctype: a node, and none that can go in an element. */
const isDocumentOrDoctype = (value: unknown): boolean => {
  const type = (value as { nodeType?: unknown } | null)?.nodeType;
  return type === 9 || type === 10;
};

/** A node a node is handed, as WebIDL takes a `Node`: anything else is a `TypeError`. */
function nodeGiven(value: unknown, method: string): EngineNode {
  if (isNode(value)) return value;
  if (isDocumentOrDoctype(value)) {
    throw hierarchy('Only an element, a text or a comment goes in an element.');
  }
  throw new TypeError(`Failed to execute '${method}': the node given is not a Node.`);
}

/** Throw where `node` cannot go in `parent`: a parent with no children, or a node above it. */
function checkPlace(parent: EngineNode, node: EngineNode): void {
  if (parent.nodeKind !== 'element') throw hierarchy('Only an element holds other nodes.');
  for (let at: EngineNode | null = parent; at; at = at.parent) {
    if (at === node) throw hierarchy('A node cannot go in itself or in what it holds.');
  }
}

/**
 * The node `appendChild`, `insertBefore` and `replaceChild` are handed, checked as a browser
 * checks it before anything moves. `child` is the one it goes before or in the place of, which
 * must be the parent's own.
 */
export function checkInsertion(
  parent: EngineNode,
  value: unknown,
  child: unknown,
  method: string,
): EngineNode {
  const node = nodeGiven(value, method);
  if (child !== null && child !== undefined && !isNode(child)) {
    throw new TypeError(`Failed to execute '${method}': the child given is not a Node.`);
  }
  checkPlace(parent, node);
  if (child && child.parent !== parent) {
    throw domError('The node to go before is not a child of this node.', 'NotFoundError');
  }
  return node;
}

/** The nodes `append`, `prepend`, `before` and the rest put in a parent, checked as one. */
export function checkEach(parent: EngineNode, nodes: readonly unknown[]): void {
  for (const node of nodes) {
    if (!isNode(node)) throw hierarchy('Only an element, a text or a comment goes in an element.');
    checkPlace(parent, node);
  }
}

/** The node `removeChild` is handed, which must be the parent's own. */
export function checkRemoval(parent: EngineNode, value: unknown): EngineNode {
  if (!isNode(value) && !isDocumentOrDoctype(value)) {
    throw new TypeError("Failed to execute 'removeChild': the node given is not a Node.");
  }
  if (!isNode(value) || value.parent !== parent) {
    throw domError('The node to remove is not a child of this node.', 'NotFoundError');
  }
  return value;
}
