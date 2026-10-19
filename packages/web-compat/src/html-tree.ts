import type { Engine, EngineNode } from '@ng-native/fabric';
import type { RendererExtension } from '@ng-native/platform';
import type { html, Token, TreeAdapter, TreeAdapterTypeMap } from 'parse5';
import { createComment } from './character-data.ts';
import { markFragment } from './document-fragment.ts';
import { ownView } from './document.ts';
import { recordName } from './qualified-name.ts';
import { inDocument, lastInDocument } from './in-document.ts';

/**
 * The engine's own nodes as the tree parse5 builds: what markup is parsed as is made with
 * `engine.createElement`, `createText` and the comments of `character-data.ts`, and each element
 * is given what a template's of its name is given as it is made. See `html.ts` for what parses.
 */

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';

/** What a node is, by the DOM members this package gives every engine node. */
type Dom = EngineNode & {
  readonly localName?: string | null;
  readonly namespaceURI?: string | null;
  getAttributeNames(): string[];
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  setAttributeNS(namespace: string, name: string, value: string): void;
};

type Tree = TreeAdapterTypeMap<
  EngineNode,
  EngineNode,
  EngineNode,
  EngineNode,
  EngineNode,
  EngineNode,
  EngineNode,
  EngineNode,
  EngineNode,
  EngineNode
>;

/** What a template's elements are given as they are made and put in place: see `listen.ts`. */
let asATemplates: RendererExtension = {};
export function buildAs(extension: RendererExtension): void {
  asATemplates = extension;
}

/** Give an element a script made what a template's is given as it is made. */
export function madeByScript(node: EngineNode, engine: Engine): void {
  asATemplates.created?.(node, engine);
}

/** Tell of an element a script put in a parent, as a template's is told of. */
export function insertedByScript(node: EngineNode, parent: EngineNode, engine: Engine): void {
  if (node.nodeKind === 'element') asATemplates.inserted?.(node, parent, engine);
}

/** Tell of a node a script took out of its parent, as a template's is told of. */
export function removedByScript(node: EngineNode, engine: Engine): void {
  asATemplates.removed?.(node, engine);
}

/** Each `<template>`'s content: a fragment of its own, which its children are not. */
const contents = new WeakMap<EngineNode, EngineNode>();
/** The contents, which are in a document of their own that runs nothing. */
export const inert = new WeakSet<EngineNode>();
/** The template each content is the content of. */
const templates = new WeakMap<EngineNode, EngineNode>();

function holdContent(template: EngineNode, content: EngineNode): void {
  contents.set(template, content);
  templates.set(content, template);
  inert.add(content);
}

/** The template a fragment is the content of, where it is one's. */
export const templateOf = (content: EngineNode): EngineNode | undefined => templates.get(content);

export function contentOf(template: EngineNode, engine: Engine): EngineNode {
  let content = contents.get(template);
  if (!content) holdContent(template, (content = markFragment(ownView(engine))));
  return content;
}

/** A template's content where it has one: what is written of it and serialized in its place. */
export const contentIfAny = (template: EngineNode): EngineNode | undefined =>
  contents.get(template);

/** The attributes each element was parsed with, as parse5 compares and copies them. */
const parsedAttributes = new WeakMap<EngineNode, Token.Attribute[]>();

/** An element's attributes as parse5 has them: as parsed, or as a script reads them. */
export function attributeListOf(element: EngineNode): Token.Attribute[] {
  const parsed = parsedAttributes.get(element);
  if (parsed) return parsed;
  const dom = element as Dom;
  if (typeof dom.getAttributeNames !== 'function') return [];
  return dom.getAttributeNames().map((name) => ({ name, value: dom.getAttribute(name) ?? '' }));
}

/**
 * Give an element attributes, each in the namespace parse5 says. One the DOM refuses the name
 * of, `<p =x>`, which a parser makes and `setAttribute` cannot, is left off.
 */
export function giveAttributes(element: EngineNode, attributes: Token.Attribute[]): void {
  const dom = element as Dom;
  for (const { name, value, namespace, prefix } of attributes) {
    try {
      if (namespace) dom.setAttributeNS(namespace, prefix ? `${prefix}:${name}` : name, value);
      else dom.setAttribute(name, value);
    } catch {
      continue;
    }
  }
}

function madeElement(
  engine: Engine,
  name: string,
  namespace: string,
  attributes: Token.Attribute[],
) {
  const element = engine.createElement(name);
  recordName(element, { namespace, prefix: null, localName: name });
  asATemplates.created?.(element, engine);
  giveAttributes(element, attributes);
  parsedAttributes.set(element, attributes);
  return element;
}

function before(node: EngineNode, next: EngineNode): EngineNode | undefined {
  const children = inDocument(node);
  return children[children.indexOf(next) - 1];
}

/** Text put at the end of what a node holds, or before a child: run on from text there. */
function insertText(engine: Engine, parent: EngineNode, text: string, next?: EngineNode): void {
  const previous = next ? before(parent, next) : lastInDocument(parent);
  if (previous?.nodeKind === 'text') engine.setText(previous, (previous.nodeText ?? '') + text);
  else engine.insertBefore(parent, engine.createText(text), next ?? null);
}

/**
 * What parse5 is given as the element markup is parsed as the content of: its name, namespace and
 * attributes, in no tree. A fragment's parse sets no form from a `<form>` the element is in, which
 * is none of the fragment's (whatwg/html#12257); a `<body>` where there is no element.
 */
export function standIn(context: EngineNode | null): EngineNode {
  const dom = context as Dom | null;
  const node = {
    nodeKind: 'element',
    tag: context ? (dom!.localName ?? context.tag) : 'body',
    namespaceURI: dom?.namespaceURI ?? HTML_NAMESPACE,
    parent: null,
    childList: [],
  } as unknown as EngineNode;
  parsedAttributes.set(node, context ? attributeListOf(context) : []);
  return node;
}

/** Each parsed document's mode: quirks where it has no doctype, which a `<table>` reads. */
const modes = new WeakMap<EngineNode, html.DOCUMENT_MODE>();

/** The engine's nodes as parse5's tree: what it makes, reads and moves, it does on these. */
export function treeOf(engine: Engine): TreeAdapter<Tree> {
  const fragment = () => markFragment(ownView(engine));
  return {
    createDocument: fragment,
    createDocumentFragment: fragment,
    createElement: (name, namespace, attributes) =>
      madeElement(engine, name, namespace, attributes),
    createCommentNode: (data) => createComment(engine, data),
    createTextNode: (value) => engine.createText(value),
    appendChild: (parent, child) => engine.appendChild(parent, child),
    insertBefore: (parent, child, next) => engine.insertBefore(parent, child, next),
    setTemplateContent: holdContent,
    getTemplateContent: (template) => contentOf(template, engine),
    setDocumentType() {},
    setDocumentMode: (document, mode) => void modes.set(document, mode),
    getDocumentMode: (document) => modes.get(document) ?? ('no-quirks' as html.DOCUMENT_MODE),
    detachNode: (node) => void (node.parent && engine.removeChild(node.parent, node)),
    insertText: (parent, text) => insertText(engine, parent, text),
    insertTextBefore: (parent, text, next) => insertText(engine, parent, text, next),
    adoptAttributes(element, attributes) {
      const dom = element as Dom;
      const missing = attributes.filter(({ name }) => !dom.hasAttribute(name));
      giveAttributes(element, missing);
      parsedAttributes.set(element, [...attributeListOf(element), ...missing]);
    },
    getFirstChild: (node) =>
      node.childList.find((child) => child.nodeKind !== 'element' || !child.tag.startsWith('::')) ??
      null,
    getChildNodes: (node) => inDocument(node),
    getParentNode: (node) => node.parent ?? null,
    getAttrList: attributeListOf,
    getTagName: (element) => (element as Dom).localName ?? element.tag,
    getNamespaceURI: (element) => ((element as Dom).namespaceURI ?? HTML_NAMESPACE) as html.NS,
    getTextNodeContent: (node) => node.nodeText ?? '',
    getCommentNodeContent: (node) => node.nodeText ?? '',
    getDocumentTypeNodeName: () => '',
    getDocumentTypeNodePublicId: () => '',
    getDocumentTypeNodeSystemId: () => '',
    isTextNode: (node): node is EngineNode => node.nodeKind === 'text',
    isCommentNode: (node): node is EngineNode => node.nodeKind === 'anchor',
    isDocumentTypeNode: (_node): _node is EngineNode => false,
    isElementNode: (node): node is EngineNode => node.nodeKind === 'element',
    setNodeSourceCodeLocation() {},
    getNodeSourceCodeLocation: () => undefined,
    updateNodeSourceCodeLocation() {},
  };
}

/**
 * Put what parse5 built in a node where it goes, each element again from the top: told it is
 * inserted as a template's is, before what it holds is put in it. The tree is built apart, and
 * an element of a template is told of its place as it is put there with nothing in it yet.
 */
export function settle(node: EngineNode, into: EngineNode, engine: Engine): void {
  const children = detached(node, engine);
  engine.appendChild(into, node);
  if (node.nodeKind === 'element') asATemplates.inserted?.(node, into, engine);
  for (const child of children) settle(child, node, engine);
  const content = contents.get(node);
  if (content) for (const child of detached(content, engine)) settle(child, content, engine);
}

/** What a node holds, taken out of it. */
export function detached(node: EngineNode, engine: Engine): EngineNode[] {
  const children = inDocument(node);
  for (const child of children) engine.removeChild(node, child);
  return children;
}
