/**
 * A test's `.html` file read as a browser reads a page: parsed by parse5, the HTML parsing
 * algorithm whole, each element made in the document as its tag is reached, and each script run
 * as its end tag is, with what is above it already there. A script loaded `defer` or `async` is
 * run once the page is parsed, in the order the page has them: where a browser runs a deferred
 * one, and where it can run an async one, which a file of the checkout has loaded by then.
 * The page keeps the doctype it was written with, or has none, and is parsed in the mode that
 * gives it.
 *
 * The elements are made with the document's own `createElement`, `createElementNS`,
 * `createTextNode` and `appendChild`, not `innerHTML`: a script can keep an element an earlier
 * part of the page made, and the page after it is added to what is there. The page's `<html>`,
 * `<head>` and `<body>` are the document's own, given the attributes the page writes on them.
 */
import { parse } from 'parse5';

const HTML = 'http://www.w3.org/1999/xhtml';
/**
 * A classic script's type: none, or a JavaScript MIME type with white space about it and no
 * parameters, as a browser matches it. A module script is not run: `tests.mjs` skips its page.
 */
const JAVASCRIPT = new RegExp(
  '^[\\t\\n\\f\\r ]*(|' +
    '(text|application)/(x-)?(java|ecma)script|' +
    'text/(javascript1\\.[0-5]|jscript|livescript)' +
    ')[\\t\\n\\f\\r ]*$',
  'i',
);
const MODULE = /^[\t\n\f\r ]*module[\t\n\f\r ]*$/i;
const SPACE = /^[\t\n\f\r ]*$/;
/** What holds text that is not markup: given it whole as it ends, as the page wrote it. */
const RAW = new Set(
  'script style textarea title xmp iframe noembed noframes noscript plaintext'.split(' '),
);

/**
 * Every element under a node of parse5's own tree, in document order, but what is in a template:
 * its content is inert, and a script there is never run.
 */
function* elementsOf(node) {
  for (const child of node.childNodes ?? []) {
    if (child.tagName) yield child;
    yield* elementsOf(child);
  }
}

/** The scripts of a page's own tree a browser runs: classic and module, and not a data block. */
function* scriptsOf(source) {
  for (const element of elementsOf(parse(source))) {
    if (element.tagName !== 'script') continue;
    const type = element.attrs.find(({ name }) => name === 'type')?.value ?? '';
    if (JAVASCRIPT.test(type) || MODULE.test(type)) yield { element, type };
  }
}

/** The `src` of every script a page loads, as written. */
export function scriptSources(source) {
  const found = [];
  for (const { element } of scriptsOf(source)) {
    const src = element.attrs.find(({ name }) => name === 'src');
    if (src) found.push(src.value);
  }
  return found;
}

/**
 * Whether a page has a module script, which imports, has a scope of its own and runs after the
 * page is parsed, none of which the classic scripts here do.
 */
export function hasModuleScript(source) {
  for (const { type } of scriptsOf(source)) if (MODULE.test(type)) return true;
  return false;
}

/** An element's attributes as parse5 has them. */
const attributesOf = (element) =>
  (element.getAttributeNames?.() ?? []).map((name) => ({
    name,
    value: element.getAttribute(name) ?? '',
  }));

/**
 * The document as parse5's tree. A step the document refuses, an element it cannot make say,
 * is handed to `failed` and the page goes on from the next. A script to run once the page is
 * parsed is put in `later`.
 */
function treeOf(document, run, failed, ids, later) {
  const own = new Map([
    ['html', document.documentElement],
    ['head', document.head],
    ['body', document.body],
  ]);
  const owned = new Set(own.values());
  const attempt = (what, step) => {
    try {
      return step();
    } catch (error) {
      failed(error, what);
      return undefined;
    }
  };
  const give = (element, attributes) => {
    for (const { name, value, namespace, prefix } of attributes) {
      if (name === 'id') ids.add(value);
      attempt({ open: element.localName }, () => {
        if (namespace)
          element.setAttributeNS(namespace, prefix ? `${prefix}:${name}` : name, value);
        else element.setAttribute(name, value);
      });
    }
  };
  const create = (name, namespace) =>
    namespace === HTML ? document.createElement(name) : document.createElementNS(namespace, name);
  const append = (parent, child, next = null) => {
    // The page's own three are where they go already.
    if (owned.has(child) && child.parentNode === parent) return;
    attempt({ open: child.localName ?? child.nodeName }, () => parent.insertBefore(child, next));
  };
  /** The text of each element of raw text that is open, put in it as one when it ends. */
  const pending = new Map();
  /** The mode the doctype gives the page, and whether it had one, to put in place of HTML's own. */
  let mode = 'no-quirks';
  let doctyped = false;
  const unDoctype = () => {
    if (document.doctype) attempt({ doctype: true }, () => document.removeChild(document.doctype));
  };
  const insertText = (parent, text, next = null) => {
    if (RAW.has(parent.localName) && parent.namespaceURI === HTML && next === null) {
      pending.set(parent, (pending.get(parent) ?? '') + text);
      return;
    }
    // White space between the page's own elements is left out: the body is there before it.
    if ((parent === document || parent === document.documentElement) && SPACE.test(text)) return;
    const previous = next ? next.previousSibling : parent.lastChild;
    if (previous?.nodeType === 3) previous.data += text;
    else append(parent, document.createTextNode(text), next);
  };
  return {
    createDocument: () => document,
    createDocumentFragment: () => document.createDocumentFragment(),
    createElement(name, namespace, attributes) {
      const element =
        (namespace === HTML && own.get(name)) ||
        attempt({ open: name }, () => create(name, namespace)) ||
        document.createElement('span');
      own.delete(name);
      give(element, attributes);
      return element;
    },
    createCommentNode: (data) => document.createComment(data),
    createTextNode: (value) => document.createTextNode(value),
    appendChild: (parent, child) => append(parent, child),
    insertBefore: (parent, child, next) => append(parent, child, next),
    setTemplateContent() {},
    getTemplateContent: (template) => template.content ?? template,
    setDocumentType(_, name, publicId, systemId) {
      doctyped = true;
      unDoctype();
      attempt({ doctype: name }, () =>
        document.insertBefore(
          document.implementation.createDocumentType(name, publicId, systemId),
          document.firstChild,
        ),
      );
    },
    // Told once, as the page's first token is read: after its doctype, where it has one.
    setDocumentMode(_, given) {
      mode = given;
      if (!doctyped) unDoctype();
    },
    getDocumentMode: () => mode,
    detachNode: (node) =>
      attempt({ close: node.localName }, () => node.parentNode?.removeChild(node)),
    insertText: (parent, text) => insertText(parent, text),
    insertTextBefore: (parent, text, next) => insertText(parent, text, next),
    adoptAttributes: (element, attributes) =>
      give(
        element,
        attributes.filter(({ name }) => !element.hasAttribute(name)),
      ),
    getFirstChild: (node) => node.firstChild,
    getChildNodes: (node) => [...node.childNodes],
    getParentNode: (node) => node.parentNode,
    getAttrList: attributesOf,
    getTagName: (element) => element.localName,
    getNamespaceURI: (element) => element.namespaceURI ?? HTML,
    getTextNodeContent: (node) => node.data,
    getCommentNodeContent: (node) => node.data,
    getDocumentTypeNodeName: (node) => node.name,
    getDocumentTypeNodePublicId: (node) => node.publicId,
    getDocumentTypeNodeSystemId: (node) => node.systemId,
    isTextNode: (node) => node.nodeType === 3,
    isCommentNode: (node) => node.nodeType === 8,
    isDocumentTypeNode: (node) => node.nodeType === 10,
    isElementNode: (node) => node.nodeType === 1,
    setNodeSourceCodeLocation() {},
    getNodeSourceCodeLocation: () => undefined,
    updateNodeSourceCodeLocation() {},
    // A script runs as its end tag is reached, where it is in the page and not a template's, or
    // once the page is parsed: see the head of this file.
    onItemPop(element) {
      const text = pending.get(element);
      pending.delete(element);
      if (text !== undefined) append(element, document.createTextNode(text));
      if (element.localName !== 'script' || !element.isConnected) return;
      const type = element.getAttribute('type') ?? '';
      if (!JAVASCRIPT.test(type)) return;
      const src = element.getAttribute('src');
      if (src === null) run({ code: element.textContent });
      else if (element.hasAttribute('defer') || element.hasAttribute('async')) later.push({ src });
      else run({ src });
    },
  };
}

/**
 * Build a page in a document, running each script as it is reached or once the page is parsed:
 * `run` is given `{ src }` or `{ code }`. A step that throws, an element the document cannot
 * make say, is handed to `failed` and the page goes on from the next. Answers the ids the page
 * gave its elements.
 */
export function buildPage(source, document, run, failed) {
  const ids = new Set();
  const later = [];
  parse(source, { treeAdapter: treeOf(document, run, failed, ids, later) });
  for (const script of later) run(script);
  return ids;
}
