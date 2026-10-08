/**
 * The inert document Angular parses an ICU case in.
 *
 * A plural or select reaches the runtime as text, and the runtime reads each case by handing it to
 * the DOM: `document.implementation.createHTMLDocument()`, a `<template>` in that document, the
 * case as its `innerHTML`, and then a walk over what the parser made of it. There is no DOM here,
 * so this is the parser and the nodes, and nothing more of either than that walk reads:
 * `firstChild`, `nextSibling`, `nodeType`, `textContent`, `tagName`, `attributes` and
 * `namespaceURI`. Nothing made here is ever rendered or reaches the engine.
 *
 * ponytail: text, comments, elements with attributes, and numeric character references with the
 * six named ones below; any other name stays as written. `@ng-native/components` has HTML's full
 * table for `<markdown>`, which this layer cannot import and every app would carry. Not an HTML
 * parser: no implied end tags, no raw-text elements. A case is a line of a translation.
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr', 'area', 'col', 'source', 'track']);
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** A comment, a closing tag, an opening tag with its attributes, or the text up to the next `<`. */
const TOKEN =
  /<!--([\s\S]*?)-->|<\/([a-zA-Z][^\s>]*)[^>]*>|<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/g;
const ATTRIBUTE = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g;
const REFERENCE = /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi;

/** A reference to no character, or to one outside Unicode, is U+FFFD, as HTML makes it. */
const decode = (text: string): string =>
  text.replace(REFERENCE, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name) return NAMED[name] ?? whole;
    const code = decimal ? Number(decimal) : parseInt(hex ?? '', 16);
    const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return valid ? String.fromCodePoint(code) : '\ufffd';
  });

interface InertAttribute {
  readonly name: string;
  readonly value: string;
}

class InertNode {
  readonly namespaceURI = null;
  readonly nodeType: number;
  readonly nodeName: string;
  readonly textContent: string;
  firstChild: InertNode | null = null;
  nextSibling: InertNode | null = null;
  private lastChild: InertNode | null = null;
  private readonly attributeList: readonly InertAttribute[];

  constructor(
    nodeType: number,
    nodeName: string,
    textContent = '',
    attributeList: readonly InertAttribute[] = [],
  ) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.textContent = textContent;
    this.attributeList = attributeList;
  }

  get tagName(): string {
    return this.nodeName;
  }

  get attributes(): { length: number; item(index: number): InertAttribute | null } {
    const list = this.attributeList;
    return { length: list.length, item: (index) => list[index] ?? null };
  }

  set innerHTML(html: string) {
    this.firstChild = this.lastChild = null;
    parseInto(this, String(html));
  }

  append(child: InertNode): void {
    if (this.lastChild) this.lastChild.nextSibling = child;
    else this.firstChild = child;
    this.lastChild = child;
  }
}

function parseInto(root: InertNode, html: string): void {
  const open = [root];
  const parent = () => open[open.length - 1] ?? root;
  for (const [, comment, closing, opening, attributes = '', text] of html.matchAll(TOKEN)) {
    if (comment !== undefined) {
      parent().append(new InertNode(COMMENT_NODE, '#comment', comment));
    } else if (closing) {
      const at = open.map((node) => node.nodeName).lastIndexOf(closing.toUpperCase());
      if (at > 0) open.length = at;
    } else if (opening) {
      const element = new InertNode(
        ELEMENT_NODE,
        opening.toUpperCase(),
        '',
        Array.from(attributes.matchAll(ATTRIBUTE), (match) => ({
          name: match[1] ?? '',
          value: decode(match[2] ?? match[3] ?? match[4] ?? ''),
        })),
      );
      parent().append(element);
      if (!VOID.has(opening.toLowerCase()) && !attributes.trimEnd().endsWith('/')) {
        open.push(element);
      }
    } else if (text) {
      parent().append(new InertNode(TEXT_NODE, '#text', decode(text)));
    }
  }
}

/** What Angular's `InertDocumentHelper` asks a document for: `implementation`, and no more. */
export const inertImplementation = {
  createHTMLDocument: () => ({
    createElement: (tag: string) => new InertNode(ELEMENT_NODE, tag.toUpperCase()),
  }),
};
