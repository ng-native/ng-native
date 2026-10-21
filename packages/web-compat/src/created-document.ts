import type { EngineNode } from '@ng-native/fabric';
import { documentOfRoot, topOf } from './document-roots.ts';

/**
 * Which nodes are in a document `document.implementation` made, which is never drawn: see
 * `dom-implementation.ts`. Kept apart from it so that what reads markup can ask without reaching
 * back up for the document.
 */

/** The documents a script made. */
const madeDocuments = new WeakSet<object>();
/** Each made document, by a node it made, where that node is at the top of a tree of its own. */
const made = new WeakMap<EngineNode, object>();

/** A document is one a script made, and none of the page's. */
export const noteMadeDocument = (document: object): void => void madeDocuments.add(document);

export const markMade = <T extends EngineNode>(node: T, document: object): T => {
  made.set(node, document);
  return node;
};

/** A node made the page's again, as adopting it into the page does. */
export const unmarkMade = (node: EngineNode): void => void made.delete(node);

/**
 * The made document a node belongs to: the one its tree is in, or that made the node at the top
 * of the tree it is in, where that is in no document. Nothing for one of the app's page.
 */
export function madeDocumentOf(node: EngineNode): object | undefined {
  const top = topOf(node);
  const document = documentOfRoot(top) ?? made.get(top);
  return document && madeDocuments.has(document) ? document : undefined;
}

/** The made documents that are XML's, an XHTML one among them: any at all, first. */
const xml = new WeakSet<object>();
let anyXml = false;

/** A made document is an XML one: an HTML element of it is named as it is written. */
export function markXml(document: object): void {
  anyXml = true;
  xml.add(document);
}

/** Whether a node is of an XML document, which says an HTML element's name in its own case. */
export const inXmlDocument = (node: EngineNode): boolean => {
  if (!anyXml) return false;
  const document = madeDocumentOf(node);
  return document !== undefined && xml.has(document);
};
