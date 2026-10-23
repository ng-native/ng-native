import type { EngineNode } from '@ng-native/fabric';
import { isFragment } from './document-fragment.ts';
import { isInDocument } from './in-document.ts';
import { XHTML } from './qualified-name.ts';

/**
 * The tree of elements as a selector walks it: no text, no comment, no fragment, and none of the
 * `::before` and `::after` boxes the engine keeps among an element's children, nor what a
 * drawing keeps of its own: see `isInDocument`.
 */

/** Whether a node is an element a selector can match. */
export const isElement = (node: EngineNode): boolean =>
  node.nodeKind === 'element' && isInDocument(node) && !isFragment(node);

/** The element a node is in, or nothing at the top of a tree or of a fragment. */
export function parentElement(node: EngineNode): EngineNode | null {
  const parent = node.parent;
  return parent && isElement(parent) ? parent : null;
}

/** The element just before `node` among its siblings, or nothing. */
export function previousElement(node: EngineNode): EngineNode | null {
  const siblings = node.parent?.childList;
  if (!siblings) return null;
  for (let i = siblings.indexOf(node) - 1; i >= 0; i--) {
    if (isElement(siblings[i]!)) return siblings[i]!;
  }
  return null;
}

/** The elements after `node` among its siblings, in order. */
export function* laterElements(node: EngineNode): Generator<EngineNode> {
  const siblings = node.parent?.childList;
  if (!siblings) return;
  for (let i = siblings.indexOf(node) + 1; i < siblings.length; i++) {
    if (isElement(siblings[i]!)) yield siblings[i]!;
  }
}

/** Every element under `node`, in document order, walked without recursion. */
export function* elementsUnder(node: EngineNode): Generator<EngineNode> {
  const stack: EngineNode[] = [];
  for (let i = node.childList.length - 1; i >= 0; i--) stack.push(node.childList[i]!);
  while (stack.length) {
    const at = stack.pop()!;
    if (at.nodeKind !== 'element' || !isInDocument(at)) continue;
    yield at;
    const children = at.childList;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
}

/**
 * Where an element is among its siblings, from one, counting from the start or the end, and only
 * those that `counts` says. An element with no parent is the only one there is.
 */
export function positionOf(
  node: EngineNode,
  fromEnd: boolean,
  counts: (sibling: EngineNode) => boolean,
): number {
  const siblings = node.parent?.childList;
  if (!siblings) return 1;
  let at = 0;
  const step = fromEnd ? -1 : 1;
  for (let i = fromEnd ? siblings.length - 1 : 0; i >= 0 && i < siblings.length; i += step) {
    const sibling = siblings[i]!;
    if (sibling !== node && (!isElement(sibling) || !counts(sibling))) continue;
    at++;
    if (sibling === node) return at;
  }
  return at;
}

/** What a script reads of an element: its DOM members. */
const dom = (node: EngineNode): Record<string, unknown> =>
  node as unknown as Record<string, unknown>;

/** An element's name, and the namespace it is in, as `localName` and `namespaceURI` say. */
export const localNameOf = (node: EngineNode): string => String(dom(node)['localName']);
export const namespaceOf = (node: EngineNode): string | null =>
  dom(node)['namespaceURI'] as string | null;

/** One of HTML's elements by its name: `button`, not a `<button>` of some other namespace. */
export const isHtml = (node: EngineNode, ...names: string[]): boolean =>
  namespaceOf(node) === XHTML && names.includes(localNameOf(node));

/** An attribute as `getAttribute` reads it. */
export const attributeOf = (node: EngineNode, name: string): string | null =>
  (dom(node)['getAttribute'] as ((name: string) => string | null) | undefined)?.call(node, name) ??
  null;
export const hasAttribute = (node: EngineNode, name: string): boolean =>
  attributeOf(node, name) !== null;

/**
 * Whether `contenteditable` makes an element editable: by its own value, or by the nearest
 * element above with one where its own is missing, `inherit`, or none of the keywords.
 */
export function editedByContent(node: EngineNode): boolean {
  for (let at: EngineNode | null = node; at; at = parentElement(at)) {
    const value = attributeOf(at, 'contenteditable')?.toLowerCase();
    if (value === '' || value === 'true' || value === 'plaintext-only') return true;
    if (value === 'false') return false;
  }
  return false;
}
