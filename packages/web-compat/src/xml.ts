/**
 * An XML document's markup, parsed into a made document: what an `<iframe>` shows of a `.xml`,
 * `.xhtml` or `.svg` file. Elements are made with the document's own `createElementNS`, in the
 * namespace their prefix, or the default namespace, is declared for where they are; text,
 * comments, CDATA sections, processing instructions and the doctype each the node of its kind.
 *
 * Markup that is not well-formed is a document holding a `<parsererror>`, as a browser makes it.
 *
 * ponytail: the five entities XML has and character references. A doctype's internal subset is
 * skipped, so an entity it declares is an error; no encoding but the string's own is read.
 */

/** A made document, by the members the parse builds with. */
export interface XmlTarget {
  createElementNS(namespace: string | null, name: string): XmlNode;
  createTextNode(data: string): XmlNode;
  createComment(data: string): XmlNode;
  createCDATASection(data: string): XmlNode;
  createProcessingInstruction(target: string, data: string): XmlNode;
  appendChild(node: unknown): unknown;
  readonly implementation: {
    createDocumentType(name: string, publicId: string, systemId: string): unknown;
  };
}

interface XmlNode {
  appendChild(node: unknown): unknown;
  setAttributeNS(namespace: string | null, name: string, value: string): void;
}

export const PARSER_ERROR = 'http://www.mozilla.org/newlayout/xml/parsererror.xml';
const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

const ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

const NAME = /^[A-Za-z_:À-￿][\w.:·À-￿-]*/;
const SPACE = /^[\t\n\r ]*/;

class NotWellFormed extends Error {}

const isDeclaration = (name: string): boolean => name === 'xmlns' || name.startsWith('xmlns:');

/** The namespaces where an element is: those it is in, with those its attributes declare. */
function declared(
  outer: ReadonlyMap<string, string | null>,
  attributes: readonly [string, string][],
): Map<string, string | null> {
  const namespaces = new Map(outer);
  for (const [name, value] of attributes) {
    if (isDeclaration(name)) namespaces.set(name === 'xmlns' ? '' : name.slice(6), value || null);
  }
  return namespaces;
}

/** The namespace of a name: its prefix's, or for an element with none, the default one. */
function namespaceOf(
  namespaces: ReadonlyMap<string, string | null>,
  qualified: string,
  element: boolean,
): string | null {
  const colon = qualified.indexOf(':');
  if (colon < 0) return element ? (namespaces.get('') ?? null) : null;
  const prefix = qualified.slice(0, colon);
  const namespace = namespaces.get(prefix);
  if (!namespace) throw new NotWellFormed(`The prefix "${prefix}" is not declared.`);
  return namespace;
}

/** Text with its references replaced by what they stand for. */
function decode(text: string): string {
  return text.replace(/&([^;&]*);?/g, (whole, name: string) => {
    if (!whole.endsWith(';')) throw new NotWellFormed('A reference is not ended with ";".');
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    const value = ENTITIES[name];
    if (value === undefined) throw new NotWellFormed(`The entity "${name}" is not defined.`);
    return value;
  });
}

interface Open {
  readonly node: XmlNode | XmlTarget;
  readonly name: string;
  /** The namespaces declared for each prefix where this element is, '' the default. */
  readonly namespaces: ReadonlyMap<string, string | null>;
}

/** Parse markup into an empty made document. Answers whether it was well-formed. */
export function parseXml(markup: string, document: XmlTarget): boolean {
  try {
    new Parser(markup, document).parse();
    return true;
  } catch (error) {
    if (!(error instanceof NotWellFormed)) throw error;
    // What was put in the document before the error is taken out again.
    const holder = document as unknown as {
      childNodes: ArrayLike<unknown>;
      removeChild(n: unknown): void;
    };
    for (const child of Array.from(holder.childNodes)) holder.removeChild(child);
    const report = document.createElementNS(PARSER_ERROR, 'parsererror');
    report.appendChild(document.createTextNode(error.message));
    document.appendChild(report);
    return false;
  }
}

class Parser {
  #at = 0;
  #rooted = false;
  readonly #stack: Open[];

  readonly markup: string;
  readonly document: XmlTarget;

  constructor(markup: string, document: XmlTarget) {
    this.markup = markup;
    this.document = document;
    const namespaces = new Map<string, string | null>([
      ['xml', XML],
      ['xmlns', XMLNS],
      ['', null],
    ]);
    this.#stack = [{ node: document, name: '', namespaces }];
  }

  get #rest(): string {
    return this.markup.slice(this.#at);
  }

  /** The character at where the parse is. */
  #next(): string | undefined {
    return this.markup[this.#at];
  }

  #skip(pattern: RegExp): string {
    const found = pattern.exec(this.#rest)?.[0] ?? '';
    this.#at += found.length;
    return found;
  }

  #until(end: string, what: string): string {
    const at = this.markup.indexOf(end, this.#at);
    if (at < 0) throw new NotWellFormed(`${what} is not ended.`);
    const text = this.markup.slice(this.#at, at);
    this.#at = at + end.length;
    return text;
  }

  get #open(): Open {
    return this.#stack.at(-1)!;
  }

  #append(node: unknown): void {
    this.#open.node.appendChild(node);
  }

  parse(): void {
    if (this.#rest.startsWith('<?xml')) this.#until('?>', 'The XML declaration');
    while (this.#at < this.markup.length) this.#step();
    if (this.#stack.length > 1) throw new NotWellFormed(`<${this.#open.name}> is not closed.`);
    if (!this.#rooted) throw new NotWellFormed('The document has no element.');
  }

  #step(): void {
    const rest = this.#rest;
    if (rest.startsWith('<!--')) {
      this.#at += 4;
      this.#append(this.document.createComment(this.#until('-->', 'A comment')));
    } else if (rest.startsWith('<![CDATA[')) {
      this.#inElement('A CDATA section');
      this.#at += 9;
      this.#append(this.document.createCDATASection(this.#until(']]>', 'A CDATA section')));
    } else if (rest.startsWith('<!DOCTYPE')) {
      this.#doctype();
    } else if (rest.startsWith('<?')) {
      this.#at += 2;
      const target = this.#skip(NAME);
      if (!target) throw new NotWellFormed('A processing instruction has no target.');
      this.#skip(SPACE);
      this.#append(
        this.document.createProcessingInstruction(
          target,
          this.#until('?>', 'A processing instruction'),
        ),
      );
    } else if (rest.startsWith('</')) {
      this.#close();
    } else if (rest.startsWith('<')) {
      this.#element();
    } else {
      const next = this.markup.indexOf('<', this.#at);
      const text = this.markup.slice(this.#at, next < 0 ? undefined : next);
      this.#at += text.length;
      if (this.#stack.length === 1) {
        if (!/^[\t\n\r ]*$/.test(text)) throw new NotWellFormed('Text is outside the element.');
        return;
      }
      this.#append(this.document.createTextNode(decode(text)));
    }
  }

  #inElement(what: string): void {
    if (this.#stack.length === 1) throw new NotWellFormed(`${what} is outside the element.`);
  }

  #doctype(): void {
    if (this.#rooted || this.#stack.length > 1) throw new NotWellFormed('A doctype is misplaced.');
    this.#at += 9;
    this.#skip(SPACE);
    const name = this.#skip(NAME);
    this.#skip(SPACE);
    let publicId = '';
    let systemId = '';
    const quoted = () => {
      this.#skip(SPACE);
      const quote = this.#next();
      if (quote !== '"' && quote !== "'") throw new NotWellFormed('An identifier is not quoted.');
      this.#at++;
      return this.#until(quote, 'An identifier');
    };
    if (this.#rest.startsWith('PUBLIC')) {
      this.#at += 6;
      publicId = quoted();
      systemId = quoted();
    } else if (this.#rest.startsWith('SYSTEM')) {
      this.#at += 6;
      systemId = quoted();
    }
    this.#skip(SPACE);
    // The internal subset, skipped.
    if (this.#rest.startsWith('[')) this.#until(']', 'The internal subset');
    this.#skip(SPACE);
    if (this.#next() !== '>') throw new NotWellFormed('The doctype is not ended.');
    this.#at++;
    this.#append(this.document.implementation.createDocumentType(name, publicId, systemId));
  }

  #element(): void {
    this.#at++;
    const name = this.#skip(NAME);
    if (!name) throw new NotWellFormed('An element has no name.');
    if (this.#stack.length === 1 && this.#rooted) {
      throw new NotWellFormed('The document has more than one element.');
    }
    const attributes = this.#attributes(name);
    const namespaces = declared(this.#open.namespaces, attributes);
    const node = this.document.createElementNS(namespaceOf(namespaces, name, true), name);
    for (const [attribute, value] of attributes) {
      const namespace = isDeclaration(attribute)
        ? XMLNS
        : namespaceOf(namespaces, attribute, false);
      node.setAttributeNS(namespace, attribute, value);
    }
    this.#append(node);
    if (this.#stack.length === 1) this.#rooted = true;
    if (this.#rest.startsWith('/>')) {
      this.#at += 2;
      return;
    }
    this.#at++;
    this.#stack.push({ node, name, namespaces });
  }

  /** An element's attributes, by name and value, up to the end of its start tag. */
  #attributes(element: string): [string, string][] {
    const attributes: [string, string][] = [];
    for (;;) {
      const space = this.#skip(SPACE);
      if (this.#rest.startsWith('/>') || this.#rest.startsWith('>')) return attributes;
      if (!space) throw new NotWellFormed(`<${element}> is not well-formed.`);
      const name = this.#skip(NAME);
      if (!name) throw new NotWellFormed(`<${element}> has an attribute with no name.`);
      if (attributes.some(([each]) => each === name)) {
        throw new NotWellFormed(`${name} is given twice.`);
      }
      attributes.push([name, this.#value(name)]);
    }
  }

  /** What an attribute is given, after its name: `="..."`. */
  #value(name: string): string {
    this.#skip(SPACE);
    if (this.#next() !== '=') throw new NotWellFormed(`${name} has no value.`);
    this.#at++;
    this.#skip(SPACE);
    const quote = this.#next();
    if (quote !== '"' && quote !== "'") throw new NotWellFormed(`${name} is not quoted.`);
    this.#at++;
    const value = this.#until(quote, `The value of ${name}`);
    if (value.includes('<')) throw new NotWellFormed(`The value of ${name} holds "<".`);
    return decode(value).replace(/[\t\n\r]/g, ' ');
  }

  #close(): void {
    this.#at += 2;
    const name = this.#skip(NAME);
    this.#skip(SPACE);
    if (this.#next() !== '>') throw new NotWellFormed(`</${name}> is not ended.`);
    this.#at++;
    if (this.#stack.length === 1 || this.#open.name !== name) {
      throw new NotWellFormed(`</${name}> does not close the element that is open.`);
    }
    this.#stack.pop();
  }
}
