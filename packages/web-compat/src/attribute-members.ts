import type { EngineNode } from '@ng-native/fabric';
import {
  attributesOf,
  getAttributeNode,
  getAttributeNodeNS,
  keptNameNS,
  removeAttributeNode,
  setAttributeNode,
} from './attr.ts';
import { required } from './dom-error.ts';
import { removingAttribute } from './mutation-observer.ts';
import { writeAttribute } from './node-members.ts';
import { attributeNameOf, extractName, noteAttributeName } from './qualified-name.ts';

/**
 * The members of an element for its attributes in a namespace, `setAttributeNS` and the rest, and
 * for its attributes as nodes: `attributes`, `getAttributeNode` and the rest, see `attr.ts`.
 */

type Dom = EngineNode & {
  readonly namespaceURI: string | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  getAttributeNames(): string[];
};

const get = (read: (this: Dom) => unknown) => ({ get: read });
const method = (value: (this: Dom, ...args: never[]) => unknown) => ({ value, writable: true });

/**
 * The name an attribute in a namespace is kept by. One a template wrote with a prefix,
 * `xlink:href`, was noted in no namespace, and is found by its local name in any but none.
 */
function qualified(node: Dom, namespace: unknown, local: string): string | undefined {
  const kept = keptNameNS(node, namespace, local);
  if (kept !== undefined || namespace === null || namespace === undefined || namespace === '') {
    return kept;
  }
  return node.getAttributeNames().find((name) => name.endsWith(`:${local}`));
}

export const attributeMembers: PropertyDescriptorMap = {
  attributes: get(function () {
    return this.nodeKind === 'element' ? attributesOf(this) : undefined;
  }),
  // Its name checked against its namespace, as a browser does, and the names kept.
  setAttributeNS: method(function (...args: unknown[]) {
    required(args, 3, 'setAttributeNS');
    const given = String(args[1]);
    const name = extractName(args[0], given, 'attribute');
    // Where it has one by these names, under another prefix, that one is set.
    const kept = keptNameNS(this, name.namespace, name.localName) ?? given;
    const names = kept === given ? name : attributeNameOf(this, kept);
    // As it is written: a name in a namespace keeps its capitals, in an HTML document as well.
    writeAttribute(this, kept, String(args[2]), names.namespace);
    noteAttributeName(this, kept, names);
  }),
  getAttributeNS: method(function (namespace: unknown, local: unknown) {
    const name = qualified(this, namespace, String(local));
    return name !== undefined && this.hasAttribute(name) ? this.getAttribute(name) : null;
  }),
  hasAttributeNS: method(function (namespace: unknown, local: unknown) {
    const name = qualified(this, namespace, String(local));
    return name !== undefined && this.hasAttribute(name);
  }),
  removeAttributeNS: method(function (namespace: unknown, local: unknown) {
    const kept = keptNameNS(this, namespace, String(local));
    if (kept === undefined) return;
    const space = attributeNameOf(this, kept).namespace;
    removingAttribute(this, kept, () => this.removeAttribute(kept), space);
  }),
  getAttributeNode: method(function (name: unknown) {
    return getAttributeNode(this, name);
  }),
  getAttributeNodeNS: method(function (namespace: unknown, local: unknown) {
    return getAttributeNodeNS(this, namespace, local);
  }),
  setAttributeNode: method(function (attr: unknown) {
    return setAttributeNode(this, attr);
  }),
  setAttributeNodeNS: method(function (attr: unknown) {
    return setAttributeNode(this, attr);
  }),
  removeAttributeNode: method(function (attr: unknown) {
    return removeAttributeNode(this, attr);
  }),
};
