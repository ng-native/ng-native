import type { EngineNode } from '@ng-native/fabric';
import { domError } from './dom-error.ts';

/**
 * The names of an element a script makes, as the DOM has them: its namespace, its prefix and its
 * local name, which the engine has no place for. Kept by the element, for `createElement` and
 * `createElementNS` to give and `localName`, `prefix`, `namespaceURI` and `tagName` to read. An
 * element a template makes has none kept, and is named as it was before: see `node-members.ts`.
 *
 * And the names the DOM refuses, with the error a browser throws for each.
 */

export const XHTML = 'http://www.w3.org/1999/xhtml';
export const SVG = 'http://www.w3.org/2000/svg';
export const XML = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS = 'http://www.w3.org/2000/xmlns/';

export interface QualifiedName {
  readonly namespace: string | null;
  readonly prefix: string | null;
  readonly localName: string;
}

const names = new WeakMap<EngineNode, QualifiedName>();

export const nameRecordOf = (node: EngineNode): QualifiedName | undefined => names.get(node);
export const recordName = (node: EngineNode, name: QualifiedName): void =>
  void names.set(node, name);

/** A copy of an element is named as the element is. */
export function copyName(from: EngineNode, to: EngineNode): void {
  const name = names.get(from);
  if (name) names.set(to, name);
}

/** Upper case, as the DOM has a name: the ASCII letters only. */
export const asciiUpper = (name: string): string =>
  name.replace(/[a-z]+/g, (letters) => letters.toUpperCase());
export const asciiLower = (name: string): string =>
  name.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());

/** The DOM's own pattern for an element's local name: what an HTML parser could make. */
const ELEMENT_LOCAL_NAME =
  /^(?:[A-Za-z][^\0\t\n\f\r /> ]*|[:_\u0080-\u{10FFFF}][A-Za-z0-9\-.:_\u0080-\u{10FFFF}]*)$/u;
const ATTRIBUTE_LOCAL_NAME = /^[^\0\t\n\f\r /=>]+$/;
const NAMESPACE_PREFIX = /^[^\0\t\n\f\r />]+$/;

/** XML's `Name` production, which a processing instruction's target has to be. */
const NAME_START = [
  ':A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF',
  '\\u200C\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD',
  '\\u{10000}-\\u{EFFFF}',
].join('');
const XML_NAME = new RegExp(
  `^[${NAME_START}][${NAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F\\u2040]*$`,
  'u',
);

const invalid = (name: string) =>
  domError(`'${name}' is not a valid name.`, 'InvalidCharacterError');

/** An element's local name, as `createElement` is given one. */
export function checkElementName(name: string): string {
  if (!ELEMENT_LOCAL_NAME.test(name)) throw invalid(name);
  return name;
}

/** A name XML would take, as a processing instruction's target has to be. */
export function checkXmlName(name: string): string {
  if (!XML_NAME.test(name)) throw invalid(name);
  return name;
}

/** An attribute's name, as `setAttribute` and `toggleAttribute` are given one. */
export function checkAttributeName(name: string): string {
  if (!ATTRIBUTE_LOCAL_NAME.test(name)) throw invalid(name);
  return name;
}

/** Throw where a namespace and a prefix do not go together, as the DOM refuses them. */
function checkNamespace(namespace: string | null, prefix: string | null, qualified: string): void {
  const refuse = (why: string) => {
    throw domError(why, 'NamespaceError');
  };
  if (prefix !== null && namespace === null) refuse('A prefix needs a namespace.');
  if (prefix === 'xml' && namespace !== XML) refuse('The prefix xml is for XML only.');
  const xmlns = qualified === 'xmlns' || prefix === 'xmlns';
  if (xmlns !== (namespace === XMLNS)) refuse('xmlns and its namespace go only together.');
}

/**
 * The DOM's "validate and extract": the namespace, prefix and local name of a qualified name,
 * `p:local`, for an element or for an attribute.
 */
export function extractName(
  namespace: unknown,
  qualified: string,
  kind: 'element' | 'attribute',
): QualifiedName {
  const ns =
    namespace === undefined || namespace === null || namespace === '' ? null : String(namespace);
  const colon = qualified.indexOf(':');
  const prefix = colon < 0 ? null : qualified.slice(0, colon);
  const localName = colon < 0 ? qualified : qualified.slice(colon + 1);
  if (prefix !== null && !NAMESPACE_PREFIX.test(prefix)) throw invalid(qualified);
  if (kind === 'element') checkElementName(localName);
  else checkAttributeName(localName);
  checkNamespace(ns, prefix, qualified);
  return { namespace: ns, prefix, localName };
}

/** The names of each attribute `setAttributeNS` wrote in a namespace, by its qualified name. */
const attributeNames = new WeakMap<EngineNode, Map<string, QualifiedName>>();

/**
 * Note the names an attribute is written with, by `setAttributeNS`: or that it is written with
 * none but its own, by `setAttribute`, with `null`.
 */
export function noteAttributeName(
  node: EngineNode,
  qualified: string,
  name: QualifiedName | null,
): void {
  const names = attributeNames.get(node);
  if (name === null || (name.namespace === null && name.prefix === null)) {
    names?.delete(qualified);
  } else {
    attributeNames.set(node, (names ?? new Map<string, QualifiedName>()).set(qualified, name));
  }
}

/** A copy of an element has its attributes in the namespaces the element has them in. */
export function copyAttributeNames(from: EngineNode, to: EngineNode): void {
  const names = attributeNames.get(from);
  if (names) attributeNames.set(to, new Map(names));
}

/** The names an attribute was written with: its own, in no namespace, where none were noted. */
export const attributeNameOf = (node: EngineNode, qualified: string): QualifiedName =>
  attributeNames.get(node)?.get(qualified) ?? {
    namespace: null,
    prefix: null,
    localName: qualified,
  };

/** The namespace an attribute was written in: none where it was written without one. */
export const attributeNamespace = (node: EngineNode, qualified: string): string | null =>
  attributeNameOf(node, qualified).namespace;
