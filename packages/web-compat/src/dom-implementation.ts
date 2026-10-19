import type { Engine, EngineNode } from '@ng-native/fabric';
import { markMade, markXml, noteMadeDocument } from './created-document.ts';
import { documentChildren } from './document-children.ts';
import { documentNodeMembers } from './document-node.ts';
import { required } from './dom-error.ts';
import { createComment } from './character-data.ts';
import { createProcessingInstruction } from './processing-instruction.ts';
import { createCDATASection } from './cdata-section.ts';
import { markFragment } from './document-fragment.ts';
import { createAttribute, createAttributeNS } from './attr.ts';
import { NODE_CONSTANTS } from './node-constants.ts';
import { brandNode } from './node-interfaces.ts';
import { checkElementName, SVG, XHTML } from './qualified-name.ts';
import { elementNamed } from './document.ts';
import { engineOf } from './window.ts';
import { byClassName, byName, byTagName, byTagNameNS } from './elements-by.ts';
import { descendants } from './in-document.ts';
import { createDocumentType, isDocumentType, type DocumentType } from './document-type.ts';

/**
 * `document.implementation`: documents a script makes for itself, which are never drawn. A
 * sanitizer makes one to parse markup in where nothing it holds can run or load, and Angular's
 * own `DomSanitizer` makes one as it is first asked to sanitize anything.
 *
 * A made document is a tree of the engine's nodes that is in no page: its elements answer as the
 * page's do, `innerHTML` among the rest, and a `<style>` in it styles nothing. Its nodes say it is their `ownerDocument` until one is put in the page.
 *
 * ponytail: no events of its own, no `defaultView`, no `styleSheets`, and nothing is laid out, so
 * a measurement is zero. A doctype is a node of its own beside the tree: see `document-type.ts`.
 * An XML document is made as an HTML one is, its names lower case where HTML's are. Add what a
 * library is seen to ask of one.
 */

/** What a made document is made with: the page's own, whose elements its are made as. */
interface Maker {
  createElement(name: string): EngineNode;
  createElementNS(namespace: string | null, name: string): EngineNode;
}

type Dom = EngineNode & { textContent: string; appendChild(child: EngineNode): EngineNode };

/**
 * `Document`, which every document is: `instanceof` asks a node's kind, and `new` makes a blank
 * XML document beside the page of the newest app up, as the global `document` is that app's.
 */
export class Document {
  static [Symbol.hasInstance](value: unknown): boolean {
    return (value as { nodeType?: unknown } | null)?.nodeType === 9;
  }

  constructor() {
    const page = (globalThis as unknown as { document?: { documentElement?: EngineNode } })
      .document;
    const top = page?.documentElement;
    if (!top) throw new TypeError('No document to make a Document beside.');
    return madeDocument(engineOf(top), page as Maker, 'application/xml', new.target.prototype);
  }
}

brandNode(Document.prototype);

/** What `createDocument` makes, which `instanceof` asks of as any class is asked. */
export class XMLDocument extends Document {
  static override [Symbol.hasInstance](value: unknown): boolean {
    return Function.prototype[Symbol.hasInstance].call(this, value);
  }
}

/** The content type an XML document is made with, by the namespace of its element. */
const xmlType = (namespace: string | null): string =>
  namespace === XHTML
    ? 'application/xhtml+xml'
    : namespace === SVG
      ? 'image/svg+xml'
      : 'application/xml';

/** A made document: its tree, with the members a script asks of a document, and no page. */
function madeDocument(
  engine: Engine,
  page: Maker,
  contentType: string,
  prototype: object,
): Record<string, unknown> {
  const document = Object.create(prototype) as Record<string, unknown>;
  noteMadeDocument(document);
  const html = contentType === 'text/html';
  if (!html) markXml(document);
  const root = () => document['documentElement'] as EngineNode | null;
  const under = function* (): Generator<EngineNode> {
    const top = root();
    if (!top) return;
    yield top;
    yield* descendants(top);
  };
  const all = () => [...under()].filter((node) => node.nodeKind === 'element');
  const first = (name: string) => all().find((node) => node.tag === name) ?? null;
  const title = () => first('title') as Dom | null;
  const members = {
    ...NODE_CONSTANTS,
    nodeType: 9,
    nodeName: '#document',
    nodeValue: null,
    // A document has no text of its own, and writing it changes nothing.
    get textContent() {
      return null;
    },
    set textContent(_value: unknown) {},
    location: null,
    ownerDocument: null,
    parentNode: null,
    parentElement: null,
    URL: 'about:blank',
    documentURI: 'about:blank',
    baseURI: 'about:blank',
    contentType,
    characterSet: 'UTF-8',
    charset: 'UTF-8',
    inputEncoding: 'UTF-8',
    compatMode: 'CSS1Compat',
    readyState: 'complete',
    defaultView: null,
    implementation: implementationFor(engine, page, document),
    get head() {
      return root()?.childList.find((node) => node.tag === 'head') ?? null;
    },
    get body() {
      return root()?.childList.find((node) => node.tag === 'body') ?? null;
    },
    get title() {
      return (title()?.textContent ?? '').replace(/[\t\n\f\r ]+/g, ' ').trim();
    },
    set title(value: string) {
      const head = document['head'] as Dom | null;
      if (!head) return;
      const element = title() ?? head.appendChild(page.createElement('title'));
      (element as Dom).textContent = String(value);
    },
    // In an XML document, by its name as it is written, and in no namespace unless the document
    // is XHTML.
    createElement(...args: unknown[]) {
      if (html) return markMade(page.createElement(...(args as [string])), document);
      required(args, 1, 'createElement');
      const localName = checkElementName(String(args[0]));
      const namespace = contentType === 'application/xhtml+xml' ? XHTML : null;
      return markMade(elementNamed(engine, { namespace, prefix: null, localName }), document);
    },
    createElementNS: (...args: [string | null, string]) =>
      markMade(page.createElementNS(...args), document),
    createAttribute,
    createAttributeNS,
    createTextNode: (text: unknown) => markMade(engine.createText(String(text)), document),
    createComment: (data: unknown) => markMade(createComment(engine, data), document),
    createCDATASection: (...args: unknown[]) =>
      markMade(createCDATASection(engine, args, html), document),
    createProcessingInstruction: (...args: unknown[]) =>
      markMade(createProcessingInstruction(engine, args), document),
    createDocumentFragment: () => markMade(markFragment(page.createElement('view')), document),
    getElementById: (id: unknown) =>
      all().find((node) => node.props['nativeID'] === String(id)) ?? null,
    getElementsByTagName: (name: string) => byTagName(engine, under, name),
    getElementsByTagNameNS: (namespace: string | null, local: string) =>
      byTagNameNS(engine, under, namespace, local),
    getElementsByClassName: (names: string) => byClassName(engine, under, names),
    getElementsByName: (name: string) => byName(engine, under, name),
  };
  // As they are written, getters and all: `Object.assign` would read each once. And what it
  // holds, in order: see `document-children.ts`.
  Object.defineProperties(document, Object.getOwnPropertyDescriptors(members));
  Object.defineProperties(document, documentChildren(document));
  const node = documentNodeMembers(document, true);
  return Object.defineProperties(document, {
    ...Object.getOwnPropertyDescriptors(node),
    // A document of the same kind, and with `deep` a copy of what it holds.
    cloneNode: {
      value: (deep?: unknown) => {
        const copy = madeDocument(engine, page, contentType, prototype);
        if (deep !== true) return copy;
        const take = copy as unknown as Record<string, (...args: unknown[]) => unknown>;
        for (const child of document['childNodes'] as unknown[]) {
          take['appendChild']!(take['importNode']!(child, true));
        }
        return copy;
      },
      writable: true,
      configurable: true,
    },
  });
}

/** `document.implementation` for a document: the page's, or one it made. */
export function implementationFor(engine: Engine, page: Maker, owner: object): object {
  return {
    hasFeature: () => true,
    createDocumentType(...args: unknown[]) {
      required(args, 3, 'createDocumentType');
      return createDocumentType(owner, args[0], args[1], args[2]);
    },
    createHTMLDocument(title?: unknown) {
      const made = madeDocument(engine, page, 'text/html', Document.prototype);
      (made['appendChild'] as (child: unknown) => void)(createDocumentType(made, 'html'));
      const html = (made['createElement'] as Maker['createElement'])('html') as Dom;
      (made['appendChild'] as (child: EngineNode) => void)(html);
      const head = html.appendChild(page.createElement('head')) as Dom;
      html.appendChild(page.createElement('body'));
      // A title holding its words as a text, an empty one too.
      if (title !== undefined) {
        const element = head.appendChild(page.createElement('title')) as Dom;
        element.appendChild(engine.createText(String(title)));
      }
      return made;
    },
    createDocument(...args: unknown[]) {
      required(args, 2, 'createDocument');
      const [namespace, name, doctype] = args as [string | null, string | null, DocumentType?];
      if (doctype != null && !isDocumentType(doctype)) {
        throw new TypeError("Failed to execute 'createDocument': the doctype is no DocumentType.");
      }
      const made = madeDocument(engine, page, xmlType(namespace ?? null), XMLDocument.prototype);
      if (doctype) (made['appendChild'] as (child: unknown) => void)(doctype);
      if (name) {
        const element = (made['createElementNS'] as Maker['createElementNS'])(namespace, name);
        (made['appendChild'] as (child: EngineNode) => void)(element);
      }
      return made;
    },
  };
}
