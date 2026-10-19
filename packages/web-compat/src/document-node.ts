import type { EngineNode } from '@ng-native/fabric';
import { markMade, unmarkMade } from './created-document.ts';
import { adoptDocumentType, isDocumentType } from './document-type.ts';
import { domError, required } from './dom-error.ts';
import { isAnyNode } from './node-interfaces.ts';
import { containsNode, nodeGiven as positionGiven, position } from './node-relations.ts';

/**
 * What a document answers as the node it is, the page's and a made one's alike: taking nodes in
 * from other documents with `importNode` and `adoptNode`, and comparing itself and looking up a
 * namespace as any node does, through its element.
 */

interface Lookups {
  lookupNamespaceURI(prefix: unknown): string | null;
  lookupPrefix(namespace: unknown): string | null;
  isDefaultNamespace(namespace: unknown): boolean;
  isEqualNode(other: unknown): boolean;
  normalize(): void;
  cloneNode(deep: boolean): unknown;
  remove?(): void;
}

/** A node a document is handed: a document cannot be taken in, and what is no node is refused. */
function nodeGiven(node: unknown, method: string): Lookups {
  if (!isAnyNode(node)) {
    throw new TypeError(`Failed to execute '${method}': the node given is not a Node.`);
  }
  if ((node as { nodeType?: unknown }).nodeType === 9) {
    throw domError('A document cannot be taken into another.', 'NotSupportedError');
  }
  return node as Lookups;
}

/**
 * Make a node `document`'s: the made document's where it is one, or the page's, `made` false,
 * which is what a node belongs to that no made document has.
 */
function belong(node: unknown, document: object, made: boolean): void {
  if (isDocumentType(node)) adoptDocumentType(node, document);
  else if (made) markMade(node as EngineNode, document);
  else unmarkMade(node as EngineNode);
}

/** The members, for `document`: `made` where it is one a script made and not the page's. */
export function documentNodeMembers(
  document: { readonly documentElement?: unknown; readonly childNodes?: ArrayLike<unknown> },
  made: boolean,
): object {
  const element = () => (document.documentElement ?? null) as Lookups | null;
  return {
    isSameNode: (other: unknown) => other === document,
    compareDocumentPosition: (other: unknown) => position(document, positionGiven(other)),
    contains: (other: unknown) => containsNode(document, other),
    isEqualNode(other: unknown) {
      if ((other as { nodeType?: unknown } | null)?.nodeType !== 9) return false;
      const mine = Array.from(document.childNodes ?? []) as Lookups[];
      const theirs = Array.from((other as typeof document).childNodes ?? []);
      return (
        mine.length === theirs.length && mine.every((child, at) => child.isEqualNode(theirs[at]))
      );
    },
    lookupNamespaceURI: (prefix: unknown) => element()?.lookupNamespaceURI(prefix) ?? null,
    lookupPrefix: (namespace: unknown) => element()?.lookupPrefix(namespace) ?? null,
    isDefaultNamespace: (namespace: unknown) =>
      element()?.isDefaultNamespace(namespace) ??
      (namespace === null || namespace === undefined || namespace === ''),
    normalize: () => element()?.normalize(),
    // A copy of a node from anywhere, which is this document's.
    importNode(...args: unknown[]) {
      required(args, 1, 'importNode');
      const copy = nodeGiven(args[0], 'importNode').cloneNode(args[1] === true);
      belong(copy, document, made);
      return copy;
    },
    // A node from anywhere, taken out of where it is and made this document's.
    adoptNode(...args: unknown[]) {
      required(args, 1, 'adoptNode');
      const node = nodeGiven(args[0], 'adoptNode');
      node.remove?.();
      belong(node, document, made);
      return node;
    },
  };
}
