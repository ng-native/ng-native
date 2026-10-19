import { domError } from './dom-error.ts';
import { NODE_CONSTANTS } from './node-constants.ts';
import { brandNode, isAnyNode } from './node-interfaces.ts';
import { nodeGiven, position } from './node-relations.ts';

/**
 * `DocumentType`: the `<!DOCTYPE>` of a document, as `document.doctype` answers. It is a node of
 * the DOM's and none of the engine's: it is never drawn, holds nothing and goes nowhere but in a
 * document, so it is kept apart from the tree, with the document it is in noted beside it.
 *
 * ponytail: no events of its own. Add them where a library is seen to listen to one.
 */

/** What a doctype is in: a document, with the nodes it holds, where it has a list of them. */
interface Holder {
  readonly childNodes?: ArrayLike<unknown>;
  removeChild?(child: unknown): unknown;
}

/** The document each doctype is in, where it is in one. */
const parents = new WeakMap<DocumentType, Holder>();
/** The document each doctype belongs to, which adopting it gives it to. */
const owners = new WeakMap<DocumentType, object>();

/** Note the document a doctype is in, or that it is in none, with `null`. */
export function placeDocumentType(doctype: DocumentType, parent: object | null): void {
  if (parent) parents.set(doctype, parent as Holder);
  else parents.delete(doctype);
}

/** Give a doctype to another document, as adopting it does. */
export const adoptDocumentType = (doctype: DocumentType, owner: object): void =>
  void owners.set(doctype, owner);

/** Whether a value is a doctype. */
export const isDocumentType = (value: unknown): value is DocumentType =>
  value instanceof DocumentType;

const making = Symbol('making');

/** The node of a doctype. `new DocumentType()` is refused, as a browser refuses it. */
export class DocumentType {
  readonly name: string;
  readonly publicId: string;
  readonly systemId: string;

  constructor(token: unknown, owner: object, name: string, publicId: string, systemId: string) {
    if (token !== making) throw new TypeError('Illegal constructor');
    this.name = name;
    this.publicId = publicId;
    this.systemId = systemId;
    owners.set(this, owner);
  }

  get nodeType(): number {
    return 10;
  }
  get nodeName(): string {
    return this.name;
  }
  // A doctype has no value and no text, and writing either changes nothing.
  get nodeValue(): null {
    return null;
  }
  set nodeValue(_value: unknown) {}
  get textContent(): null {
    return null;
  }
  set textContent(_value: unknown) {}
  get ownerDocument(): object {
    return owners.get(this)!;
  }
  get parentNode(): object | null {
    return parents.get(this) ?? null;
  }
  get parentElement(): null {
    return null;
  }
  get isConnected(): boolean {
    return parents.has(this);
  }
  get childNodes(): readonly unknown[] {
    return [];
  }
  get firstChild(): null {
    return null;
  }
  get lastChild(): null {
    return null;
  }
  get previousSibling(): unknown {
    return this.sibling(-1);
  }
  get nextSibling(): unknown {
    return this.sibling(1);
  }
  private sibling(step: number): unknown {
    const siblings = parents.get(this)?.childNodes;
    if (!siblings) return null;
    const list = Array.from(siblings);
    return list[list.indexOf(this) + step] ?? null;
  }

  hasChildNodes(): boolean {
    return false;
  }
  isSameNode(other: unknown): boolean {
    return other === this;
  }
  isEqualNode(other: unknown): boolean {
    return (
      other instanceof DocumentType &&
      other.name === this.name &&
      other.publicId === this.publicId &&
      other.systemId === this.systemId
    );
  }
  cloneNode(): DocumentType {
    return new DocumentType(making, this.ownerDocument, this.name, this.publicId, this.systemId);
  }
  contains(other: unknown): boolean {
    return other === this;
  }
  compareDocumentPosition(other: unknown): number {
    return position(this, nodeGiven(other));
  }
  getRootNode(): object {
    return parents.get(this) ?? this;
  }
  remove(): void {
    parents.get(this)?.removeChild?.(this);
    parents.delete(this);
  }
  // It holds nothing, and nothing can be put in it.
  appendChild(node: unknown): never {
    throw holdsNothing(node, 'appendChild');
  }
  insertBefore(node: unknown, _child: unknown): never {
    throw holdsNothing(node, 'insertBefore');
  }
  replaceChild(node: unknown, _child: unknown): never {
    throw holdsNothing(node, 'replaceChild');
  }
  removeChild(): never {
    throw domError('A doctype holds nothing to remove.', 'NotFoundError');
  }
}

/** What putting a node in a doctype throws: a `TypeError` where it is given none. */
const holdsNothing = (node: unknown, method: string) =>
  isAnyNode(node)
    ? domError('A doctype holds nothing.', 'HierarchyRequestError')
    : new TypeError(`Failed to execute '${method}': the node given is not a Node.`);

brandNode(DocumentType.prototype);
for (const [name, value] of Object.entries(NODE_CONSTANTS)) {
  Object.defineProperty(DocumentType.prototype, name, { value });
}

/** The doctype of a document's, by its name: the page's is `html`. */
export const createDocumentType = (owner: object, name: string): DocumentType =>
  new DocumentType(making, owner, name, '', '');
