import { adoptDocumentType, isDocumentType } from './document-type.ts';
import { domError, required } from './dom-error.ts';
import { isAnyNode } from './node-interfaces.ts';
import { containsNode, nodeGiven as positionGiven, position } from './node-relations.ts';

/**
 * What a document answers as the node it is: taking nodes in with `importNode` and `adoptNode`,
 * and comparing itself and normalizing as any node does, through what it holds.
 */

interface Held {
  isEqualNode(other: unknown): boolean;
  normalize?(): void;
  cloneNode(deep: boolean): unknown;
  remove?(): void;
}

/** A node a document is handed: a document cannot be taken in, and what is no node is refused. */
function nodeGiven(node: unknown, method: string): Held {
  if (!isAnyNode(node)) {
    throw new TypeError(`Failed to execute '${method}': the node given is not a Node.`);
  }
  if ((node as { nodeType?: unknown }).nodeType === 9) {
    throw domError('A document cannot be taken into another.', 'NotSupportedError');
  }
  return node as Held;
}

/** The members, for `document`. */
export function documentNodeMembers(document: { readonly childNodes: ArrayLike<unknown> }): object {
  const held = () => Array.from(document.childNodes) as Held[];
  return {
    isSameNode: (other: unknown) => other === document,
    compareDocumentPosition: (other: unknown) => position(document, positionGiven(other)),
    contains: (other: unknown) => containsNode(document, other),
    isEqualNode(other: unknown) {
      if ((other as { nodeType?: unknown } | null)?.nodeType !== 9) return false;
      const mine = held();
      const theirs = Array.from((other as typeof document).childNodes ?? []);
      return (
        mine.length === theirs.length && mine.every((child, at) => child.isEqualNode(theirs[at]))
      );
    },
    normalize: () => {
      for (const child of held()) child.normalize?.();
    },
    // A copy of a node, which is this document's: every node of the app is.
    importNode(...args: unknown[]) {
      required(args, 1, 'importNode');
      const copy = nodeGiven(args[0], 'importNode').cloneNode(args[1] === true);
      if (isDocumentType(copy)) adoptDocumentType(copy, document);
      return copy;
    },
    // A node, taken out of where it is and made this document's.
    adoptNode(...args: unknown[]) {
      required(args, 1, 'adoptNode');
      const node = nodeGiven(args[0], 'adoptNode');
      node.remove?.();
      if (isDocumentType(node)) adoptDocumentType(node, document);
      return node;
    },
  };
}
