import type { Engine, EngineNode } from '@ng-native/fabric';
import { parse, parseFragment } from 'parse5';
import { markFragment, isFragment } from './document-fragment.ts';
import { documentOf, ownView } from './document.ts';
import { madeDocumentOf } from './created-document.ts';
import { attributeNameOf } from './qualified-name.ts';
import { targetOf } from './processing-instruction.ts';
import { inDocument } from './in-document.ts';
import { domError } from './dom-error.ts';
import { parseXml, type XmlTarget } from './xml.ts';
import {
  HTML_NAMESPACE,
  MATHML_NAMESPACE,
  SVG_NAMESPACE,
  attributeListOf,
  contentIfAny,
  contentOf,
  detached,
  giveAttributes,
  inert,
  settle,
  standIn,
  treeOf,
} from './html-tree.ts';

export { buildAs, contentOf, madeByScript, templateOf } from './html-tree.ts';

/**
 * Markup as a string: what a library binds to `innerHTML`, reads back from it and from
 * `outerHTML`, puts beside an element with `insertAdjacentHTML`, and parses with `DOMParser`.
 *
 * Parsed by parse5, the HTML parsing algorithm whole, into the elements, text and comments the
 * engine draws, each element given what a template's of its name is: see `html-tree.ts`. A
 * sanitizer parses untrusted markup with this, so it parses as a browser does or not at all.
 * Written back by the HTML fragment serialization algorithm, from the attributes
 * `getAttributeNames` and `getAttribute` answer, so what is read is what a script sees.
 */

/** What a node is, by the DOM members this package gives every engine node. */
type Dom = EngineNode & {
  readonly localName: string | null;
  readonly prefix: string | null;
  readonly namespaceURI: string | null;
  readonly parentNode: (Dom & { nodeType?: number }) | { nodeType: number } | null;
  readonly nextSibling: EngineNode | null;
  readonly firstChild: EngineNode | null;
  getAttributeNames(): string[];
  getAttribute(name: string): string | null;
  insertBefore(node: EngineNode, before: EngineNode | null): EngineNode;
  removeChild(node: EngineNode): EngineNode;
};

const XLINK = 'http://www.w3.org/1999/xlink';
const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** Elements with no end tag and nothing in them. */
const VOID = new Set(
  'area base basefont bgsound br col embed frame hr img input keygen link meta param source track wbr'.split(
    ' ',
  ),
);
/** Elements whose text is not markup, and is written back as it is. */
const RAW_TEXT = new Set('script style xmp iframe noembed noframes noscript plaintext'.split(' '));

// Parsing

/** A `<body>` to parse as the content of, where what is given markup is no element. */
const BODY = standIn(null);

/** The element whose content markup is parsed as: a fragment's is the body's. */
const contextOf = (node: EngineNode): EngineNode =>
  node.nodeKind !== 'element' || isFragment(node) ? BODY : standIn(node);

/**
 * Whether scripts run where a node is: not in a document `document.implementation` made, nor
 * in a template's content. Where they do not, a `<noscript>` holds markup.
 */
function scripting(node: EngineNode): boolean {
  let top = node;
  while (top.parent) top = top.parent;
  return !inert.has(top) && !madeDocumentOf(top);
}

/**
 * Markup parsed as the content of `context` and put at the end of `into`, each element told
 * where it is as a template's is. Scripts run, or not, where `scripted` is.
 */
function parseInto(
  markup: string,
  context: EngineNode,
  into: EngineNode,
  scripted: EngineNode,
  engine: Engine,
): void {
  const parsed = parseFragment(contextOf(context), markup, {
    treeAdapter: treeOf(engine),
    scriptingEnabled: scripting(scripted),
  });
  for (const node of detached(parsed, engine)) settle(node, into, engine);
}

/** Markup parsed as the content of `context`, built in a fragment of its own. */
export function fragmentOf(markup: unknown, context: EngineNode, engine: Engine): EngineNode {
  const fragment = markFragment(ownView(engine));
  // `null` is the empty string, as the attribute's type has it.
  const written = markup === null ? '' : String(markup);
  if (written !== '') parseInto(written, context, fragment, context, engine);
  return fragment;
}

/**
 * An icon's markup a template binds to a `<template>`, as `@ng-icons/core` does, which
 * `@ng-native/icons` draws from its name: the content is an empty box, and none of it is built.
 */
export function holdIconBox(template: EngineNode, engine: Engine): void {
  const content = contentOf(template, engine);
  if (content.childList.length === 0) engine.appendChild(content, ownView(engine));
}

/** Replace what an element holds with the elements, text and comments some markup is. */
export function setMarkup(node: EngineNode, markup: unknown, engine: Engine): void {
  const into = node.tag === 'template' && !isFragment(node) ? contentOf(node, engine) : node;
  for (const child of [...into.childList]) engine.removeChild(into, child);
  if (markup === null || markup === '') return;
  parseInto(String(markup), node, into, into, engine);
}

/** Whether a node's parent is a document, which no markup is put beside. */
const underDocument = (parent: Dom['parentNode']): boolean =>
  (parent as { nodeType?: number } | null)?.nodeType === 9;

/** `outerHTML` written: the element replaced by what the markup is, parsed in its parent. */
export function setOuterMarkup(node: EngineNode, markup: unknown, engine: Engine): void {
  const parent = (node as Dom).parentNode;
  if (underDocument(parent) || documentOf(engine)?.documentElement === node) {
    throw domError(
      'An element at the top of a document cannot be replaced.',
      'NoModificationAllowedError',
    );
  }
  if (!parent) return;
  const dom = parent as Dom;
  dom.insertBefore(fragmentOf(markup, dom, engine), node);
  dom.removeChild(node);
}

/** Where `insertAdjacentHTML` puts markup: in the parent before or after, or inside first or last. */
const PLACES: Readonly<Record<string, (node: Dom) => [Dom | null, EngineNode | null, boolean]>> = {
  beforebegin: (node) => [node.parentNode as Dom | null, node, false],
  afterbegin: (node) => [node, node.firstChild, true],
  beforeend: (node) => [node, null, true],
  afterend: (node) => [node.parentNode as Dom | null, node.nextSibling, false],
};

/** `insertAdjacentHTML`: what the markup is, put at a place named around an element. */
export function insertMarkup(node: EngineNode, where: unknown, markup: unknown, engine: Engine) {
  const place = PLACES[String(where).toLowerCase()];
  if (!place) throw domError(`'${String(where)}' is no place beside an element.`, 'SyntaxError');
  const [into, before, inside] = place(node as Dom);
  if (!into || (!inside && underDocument(into))) {
    throw domError(
      'There is nothing to put markup beside the element in.',
      'NoModificationAllowedError',
    );
  }
  // The page's `<html>` takes markup as its body does.
  const context = into.tag === 'html' ? BODY : into;
  into.insertBefore(fragmentOf(markup, context, engine), before);
}

// Serializing

const escapeText = (text: string): string => text.replace(/[& <>]/g, (each) => ESCAPED[each]!);
const escapeAttribute = (text: string): string =>
  text.replace(/[& "<>]/g, (each) => ESCAPED[each]!);
const ESCAPED: Readonly<Record<string, string>> = {
  '&': '&amp;',
  ' ': '&nbsp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
};

/** Whether a node's text is written as it is: in a `<style>`, a `<script>` and the rest. */
function holdsRawText(node: EngineNode): boolean {
  const dom = node as Dom;
  if (node.nodeKind !== 'element' || dom.namespaceURI !== HTML_NAMESPACE) return false;
  const name = dom.localName ?? '';
  return RAW_TEXT.has(name) && (name !== 'noscript' || scripting(node));
}

/** An element's name in markup: its local name in HTML, SVG or MathML, else its qualified one. */
function tagOf(node: Dom): string {
  const local = node.localName ?? node.tag;
  const namespace = node.namespaceURI;
  if (namespace === HTML_NAMESPACE || namespace === SVG_NAMESPACE) return local;
  if (namespace === MATHML_NAMESPACE || !node.prefix) return local;
  return `${node.prefix}:${local}`;
}

/** An attribute's name in markup: by the prefix its namespace has, else as it is kept. */
function attributeName(node: EngineNode, qualified: string): string {
  const { namespace, localName } = attributeNameOf(node, qualified);
  if (namespace === XML) return `xml:${localName}`;
  if (namespace === XMLNS) return localName === 'xmlns' ? 'xmlns' : `xmlns:${localName}`;
  if (namespace === XLINK) return `xlink:${localName}`;
  return qualified;
}

function attributesOf(node: Dom): string {
  let written = '';
  for (const name of node.getAttributeNames()) {
    const value = escapeAttribute(node.getAttribute(name) ?? '');
    written += ` ${attributeName(node, name)}="${value}"`;
  }
  return written;
}

/** Whether an element is one of HTML's that holds nothing, which writes nothing inside. */
const isVoid = (node: EngineNode): boolean =>
  node.nodeKind === 'element' &&
  (node as Dom).namespaceURI === HTML_NAMESPACE &&
  VOID.has((node as Dom).localName ?? '');

/** What a node holds as it is in the document: a template's content, the rest's children. */
function heldBy(node: EngineNode): EngineNode[] {
  const content = node.tag === 'template' ? contentIfAny(node) : undefined;
  return inDocument(content ?? node);
}

/** A comment's markup, or a processing instruction's, which HTML ends with `>` alone. */
function otherMarkup(node: EngineNode): string {
  const target = targetOf(node);
  return target === undefined ? `<!--${node.nodeText ?? ''}-->` : `<?${target} ${node.nodeText}>`;
}

function markupOfNode(node: EngineNode, raw: boolean): string {
  if (node.nodeKind === 'text')
    return raw ? (node.nodeText ?? '') : escapeText(node.nodeText ?? '');
  if (node.nodeKind !== 'element') return otherMarkup(node);
  const dom = node as Dom;
  const tag = tagOf(dom);
  const open = `<${tag}${attributesOf(dom)}>`;
  if (isVoid(node)) return open;
  return `${open}${markupOf(node)}</${tag}>`;
}

/** What a node holds, as markup: its `innerHTML`. */
export function markupOf(node: EngineNode): string {
  if (isVoid(node)) return '';
  const raw = holdsRawText(node);
  let written = '';
  for (const child of heldBy(node)) written += markupOfNode(child, raw);
  return written;
}

/** A node and what it holds, as markup: its `outerHTML`. */
export function outerMarkupOf(node: EngineNode): string {
  return markupOfNode(node, false);
}

// DOMParser

/** What `DOMParser` is asked for: an HTML document, or an XML one, which `xml.ts` parses. */
const TYPES = new Set([
  'text/html',
  'text/xml',
  'application/xml',
  'application/xhtml+xml',
  'image/svg+xml',
]);

interface Made {
  readonly body: EngineNode | null;
  readonly head: EngineNode | null;
  contentType: string;
}

/**
 * `DOMParser`: markup parsed as a document of its own, made by `document.implementation`, which
 * is never drawn and runs nothing. Angular's sanitizer parses what an `innerHTML` binding is
 * given this way, walks it, and writes the markup again without what it does not allow.
 *
 * An XML type is an XML document, its names as written and in the namespaces declared for them,
 * and a `<parsererror>` where the markup is not well-formed: see `xml.ts`.
 *
 * ponytail: what an HTML document's markup has before or after its `<html>`, a comment, is left
 * out.
 */
export function domParser(engine: () => Engine | undefined): new () => object {
  return class DOMParser {
    parseFromString(...args: unknown[]): object {
      const type = String(args[1]);
      if (!TYPES.has(type)) {
        throw new TypeError(`Failed to execute 'parseFromString': '${type}' is not a valid type.`);
      }
      const page = engine();
      const implementation = page && (documentOf(page)?.['implementation'] as Implementation);
      if (!page || !implementation) return { body: null, head: null, contentType: type };
      const markup = String(args[0] ?? '');
      if (type !== 'text/html') {
        const xml = implementation.createDocument(null, null, null) as Made;
        xml.contentType = type;
        parseXml(markup, xml as unknown as XmlTarget);
        return xml;
      }
      const made = implementation.createHTMLDocument() as Made;
      made.contentType = type;
      if (made.body) fillDocument(made, markup, page);
      return made;
    }
  };
}

interface Implementation {
  createHTMLDocument(title?: string): object;
  createDocument(namespace: null, name: null, doctype: null): object;
}

/**
 * A document's markup, parsed whole and put in a made document: what parse5 put in its head in
 * the head, in its body in the body, and the attributes of each, and of the `<html>`, on them.
 */
function fillDocument(made: Made, markup: string, engine: Engine): void {
  const parsed = parse(markup, { treeAdapter: treeOf(engine), scriptingEnabled: false });
  const html = inDocument(parsed).find((node) => node.nodeKind === 'element');
  const head = made.head!;
  const body = made.body!;
  const top = body.parent!;
  if (!html) return;
  giveAttributes(top, attributeListOf(html));
  let into: EngineNode | null = body;
  for (const node of detached(html, engine)) {
    const name = node.nodeKind === 'element' ? node.tag : '';
    if (name === 'head' || name === 'body') {
      const to = name === 'head' ? head : body;
      giveAttributes(to, attributeListOf(node));
      for (const child of detached(node, engine)) settle(child, to, engine);
      if (name === 'body') into = null;
    } else {
      // Between the head and the body, or after the body: a comment, a space or a frameset.
      (top as Dom).insertBefore(node, into);
    }
  }
}
