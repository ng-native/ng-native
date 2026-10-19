import type { Engine, EngineNode } from '@ng-native/fabric';
import type { Renderer2 } from '@angular/core';
import { isCharacterData, setData, wordsOf } from './character-data.ts';
import { classAttribute, classListOf, setClassAttribute } from './class-list.ts';
import { documentOf, eventPath, nameOf } from './document.ts';
import { isFragment } from './document-fragment.ts';
import { documentOfRoot, topOf } from './document-roots.ts';
import { required } from './dom-error.ts';
import { dispatch, listen, unlisten, type Heard } from './events.ts';
import { inDocument, isInDocument, lastInDocument } from './in-document.ts';
import { listenNatively, hasCapture, topLevel } from './listen.ts';
import { observing, removingAttribute, settingAttribute, together } from './mutation-observer.ts';
import { NODE_CONSTANTS } from './node-constants.ts';
import { engineOf } from './window.ts';

/** A node as a library holds one: an engine node with the members below on it. */
type Dom = EngineNode & Record<string, (...args: unknown[]) => unknown>;
type Listener = (event: unknown) => void;

/** What a node has in core that the members below take the place of. */
export interface CoreNode {
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}

/**
 * The renderer each app's attributes are set through, by its engine: a script's `setAttribute`
 * is set as a template's attribute is, a `style` parsed into declarations and an `id` the view's
 * `nativeID`. A node of an app that has none is given the prop as written.
 */
const renderers = new WeakMap<Engine, Renderer2>();

/** Set the attributes of an app's nodes through its renderer, until it answers to undo it. */
export function setAttributesWith(engine: Engine, renderer: Renderer2): () => void {
  renderers.set(engine, renderer);
  return () => void renderers.delete(engine);
}

/** The prop an attribute is kept as, where it is not its name. */
const PROPS: Readonly<Record<string, string>> = { id: 'nativeID' };
const propOf = (name: string): string => PROPS[name] ?? name;

/**
 * HTML attributes React Native also reads as a typed prop. Android rejects a string where it
 * wants a boolean (`focusable="false"` is a native crash), so these are coerced. Others pass as
 * written: Fabric ignores a prop a view does not know.
 */
const BOOLEAN_ATTRIBUTES = new Set([
  'focusable',
  'aria-hidden',
  'aria-disabled',
  'aria-selected',
  'aria-expanded',
  'aria-busy',
  'aria-modal',
  'aria-checked',
  'accessible',
  'disabled',
]);

function attributeValue(name: string, value: string): unknown {
  if (!BOOLEAN_ATTRIBUTES.has(name)) return value;
  if (name === 'aria-checked' && value === 'mixed') return value;
  return value !== 'false';
}

/** What a boolean prop reads back as: `disabled` as the empty string a browser reflects it with. */
const asWritten = (name: string, value: boolean): string =>
  name === 'disabled' && value ? '' : String(value);

/**
 * The text of each attribute a script wrote, by element, where it is no prop to read it back
 * from as written: a `style`, and a boolean prop's own words.
 */
const written = new WeakMap<EngineNode, Map<string, string>>();

function noteWritten(node: EngineNode, name: string, value: string | null): void {
  let all = written.get(node);
  if (value === null) return void all?.delete(name);
  if (!all) written.set(node, (all = new Map()));
  all.set(name, value);
}

/** Give a copy of a node the text of each attribute a script wrote on it: see `cloneNode`. */
export function copyWritten(from: EngineNode, to: EngineNode): void {
  const all = written.get(from);
  if (all) written.set(to, new Map(all));
}

/** Set an attribute as a template sets one: through its app's renderer where it has one. */
function setAsWritten(node: EngineNode, name: string, value: unknown): void {
  const engine = engineOf(node);
  const renderer = renderers.get(engine);
  if (value === null) renderer?.removeAttribute(node, name);
  else renderer?.setAttribute(node, name, value as string);
  if (!renderer) engine.setProp(node, propOf(name), value);
}

/** Whether an element has an attribute. */
function hasAttribute(node: EngineNode, name: string): boolean {
  if (name === 'class') return classAttribute(node) !== null;
  if (name === 'style') return written.get(node)?.has(name) ?? false;
  return node.props[propOf(name)] != null;
}

/** An attribute as `getAttribute` answers it: the text written, or what the prop says. */
function attributeOf(node: EngineNode, name: string): string | null {
  if (name === 'class') return classAttribute(node);
  const text = written.get(node)?.get(name);
  if (name === 'style') return text ?? null;
  const value = node.props[propOf(name)];
  if (value == null) return null;
  if (typeof value !== 'boolean') return String(value);
  // A boolean prop is what the text was coerced to: the text itself is what was written.
  if (text !== undefined && attributeValue(name, text) === value) return text;
  return asWritten(name, value);
}

/** What a node is in: its parent, or the document it is at the top of a tree in. */
type TopOf = { readonly childNodes?: ArrayLike<EngineNode> };
const parentOf = (node: EngineNode): EngineNode | TopOf | null =>
  node.parent ?? (documentOfRoot(node) as TopOf | undefined) ?? null;

/** The nodes beside a node: its parent's, or its document's where it is at the top of one. */
function siblingsOf(node: EngineNode): readonly EngineNode[] {
  if (node.parent) return inDocument(node.parent);
  return Array.from((documentOfRoot(node) as TopOf | undefined)?.childNodes ?? []);
}

const sibling = (node: EngineNode, by: number): EngineNode | null => {
  const siblings = siblingsOf(node);
  const at = siblings.indexOf(node);
  return at === -1 ? null : (siblings[at + by] ?? null);
};

/** The nearest element before or after a node under its parent, past any text between. */
function elementBeside(node: EngineNode, step: 1 | -1): EngineNode | null {
  const all = node.parent ? inDocument(node.parent) : [];
  for (let at = all.indexOf(node) + step; at >= 0 && at < all.length; at += step) {
    if (all[at]!.nodeKind === 'element') return all[at]!;
  }
  return null;
}

/** The words of a text, and of every text under an element: none of a comment's. */
const textOf = (node: EngineNode): string =>
  node.nodeKind === 'text' ? node.nodeText : inDocument(node).map(textOf).join('');

/** An element's name as the DOM says it, in the upper case an HTML document has it in. */
const domName = (node: EngineNode): string => nameOf(node, engineOf(node)).toUpperCase();

/**
 * Attach a listener `addEventListener` was given to what native says of its type. Core maps the
 * events a `@defer` trigger listens for to the native ones that stand for them, and does nothing
 * with any other type. But a click is the press a template's listener hears, with the event that
 * one is given: a library stops the click it acts on, which core's own event has nothing to stop
 * with. Any other type is the native event of its name.
 */
function attachNatively(node: EngineNode, type: string, heard: Heard, core: CoreNode) {
  if (DEFER_TRIGGERS.has(type)) {
    core.addEventListener.call(node, type, heard);
    return () => core.removeEventListener.call(node, type, heard);
  }
  const engine = engineOf(node);
  return (
    listenNatively(node, type, heard, engine) ??
    engine.setEventListener(node, topLevel(type), heard)
  );
}

/** The event types core's own `addEventListener` attaches, for `@defer`, but for a click. */
const DEFER_TRIGGERS = new Set(['keydown', 'mouseenter', 'focusin']);

const get = (read: (this: Dom) => unknown, write?: (this: Dom, value: unknown) => void) => ({
  get: read,
  set: write,
});
const method = (value: (this: Dom, ...args: never[]) => unknown) => ({ value, writable: true });

/** Whether a node is an element of the DOM's: no text, no comment, no fragment. */
const isElement = (node: EngineNode): boolean => node.nodeKind === 'element' && !isFragment(node);

/**
 * The DOM members every engine node answers to, for `extendNodes`. `core` is the node prototype
 * as it was: its listeners are what Angular's `@defer` triggers go through, and still do. The
 * tree's own are in `tree-members.ts`.
 */
export const nodeMembers = (core: CoreNode): PropertyDescriptorMap => ({
  // Upper case, as the DOM has an HTML element's: a library walking up stops at `HTML` or `BODY`.
  nodeName: get(function () {
    if (isFragment(this)) return '#document-fragment';
    if (this.nodeKind === 'anchor') return '#comment';
    if (this.nodeKind === 'text') return '#text';
    return domName(this);
  }),
  // An element's own name, as `nodeName` gives it: the DOM has none for a text or a comment.
  tagName: get(function () {
    return isElement(this) ? domName(this) : undefined;
  }),
  localName: get(function () {
    return isElement(this) ? nameOf(this, engineOf(this)) : null;
  }),
  // The kind of node it is: the engine says an element of everything, for Angular's own check.
  nodeType: get(function () {
    if (isFragment(this)) return 11;
    if (this.nodeKind === 'anchor') return 8;
    return this.nodeKind === 'text' ? 3 : 1;
  }),
  // `Node`'s constants, on every node as they are on a browser's: `nodeType` is compared with them.
  ...Object.fromEntries(Object.entries(NODE_CONSTANTS).map(([name, value]) => [name, { value }])),
  id: get(
    function () {
      return this.props['nativeID'] ?? '';
    },
    function (value) {
      settingAttribute(this, 'id', () => engineOf(this).setProp(this, 'nativeID', value));
    },
  ),

  // Told to an observer as it is named, even where it is set to what it was: see
  // `mutation-observer.ts`.
  setAttribute: method(function (...args: unknown[]) {
    required(args, 2, 'setAttribute');
    const name = String(args[0]);
    const value = String(args[1]);
    settingAttribute(this, name, () => {
      if (name === 'class') return setClassAttribute(this, value);
      noteWritten(this, name, value);
      setAsWritten(this, name, attributeValue(name, value));
    });
  }),
  getAttribute: method(function (name: unknown) {
    return attributeOf(this, String(name));
  }),
  hasAttribute: method(function (name: unknown) {
    return hasAttribute(this, String(name));
  }),
  removeAttribute: method(function (given: unknown) {
    const name = String(given);
    removingAttribute(this, name, () => {
      if (name === 'class') return setClassAttribute(this, null);
      if (!hasAttribute(this, name)) return;
      noteWritten(this, name, null);
      setAsWritten(this, name, null);
    });
  }),
  toggleAttribute: method(function (given: unknown, force?: boolean) {
    const name = String(given);
    const set = force ?? !hasAttribute(this, name);
    if (set) this['setAttribute']!(name, '');
    else this['removeAttribute']!(name);
    return set;
  }),

  // Written to, it is its `value` written, as a browser forwards it.
  classList: get(
    function () {
      return classListOf(this);
    },
    function (value) {
      classListOf(this).value = String(value);
    },
  ),
  className: get(
    function () {
      return classAttribute(this) ?? '';
    },
    function (value) {
      setClassAttribute(this, String(value));
    },
  ),

  // The root is in the document, which is what a walk up from any node ends at, and so is a
  // comment a script put in the document beside it: see `document-children.ts`.
  parentNode: get(function () {
    return parentOf(this);
  }),
  // None where it is in a fragment, which is no element.
  parentElement: get(function () {
    return this.parent && !isFragment(this.parent) ? this.parent : null;
  }),
  // What it holds as a browser has it: no box a rule generated.
  firstChild: get(function () {
    return this.childList.find(isInDocument) ?? null;
  }),
  lastChild: get(function () {
    return lastInDocument(this) ?? null;
  }),
  firstElementChild: get(function () {
    return inDocument(this).find((child) => child.nodeKind === 'element') ?? null;
  }),
  nextSibling: get(function () {
    return sibling(this, 1);
  }),
  previousSibling: get(function () {
    return sibling(this, -1);
  }),
  nextElementSibling: get(function () {
    return elementBeside(this, 1);
  }),
  previousElementSibling: get(function () {
    return elementBeside(this, -1);
  }),
  // In the page's document: under its root, or beside it there.
  isConnected: get(function () {
    const top = topOf(this);
    return top === engineOf(this).root || documentOfRoot(top) !== undefined;
  }),
  contains: method(function (other: EngineNode | null) {
    for (let at = other; at; at = at.parent) if (at === this) return true;
    return false;
  }),
  textContent: get(
    function () {
      return this.nodeKind === 'anchor' ? this.nodeText : textOf(this);
    },
    function (value) {
      const engine = engineOf(this);
      const text = value == null ? '' : String(value);
      if (isCharacterData(this)) return setData(this, text);
      // An element's text is all it holds: one text node, kept when it is all there already is,
      // and none for no text. Where something observes it, a new one, as a browser makes, and
      // one change for all of it.
      const [only] = this.childList;
      if (text && this.childList.length === 1 && only!.nodeKind === 'text' && !observing(this)) {
        return engine.setText(only!, text);
      }
      together(this, () => {
        for (const child of inDocument(this)) engine.removeChild(this, child);
        if (text) engine.appendChild(this, engine.createText(text));
      });
    },
  ),
  // The words of a text or a comment, and nothing of an element's, which is left as it is.
  nodeValue: get(
    function () {
      return isCharacterData(this) ? this.nodeText : null;
    },
    function (value) {
      setData(this, wordsOf(value));
    },
  ),
  // The page's document, for a node of an app that asked for one.
  ownerDocument: get(function () {
    return documentOf(engineOf(this)) ?? null;
  }),

  // A touch stays with the node that took it until it ends, so there is no capture to set or to
  // let go: a node has it for as long as the touch is on it.
  setPointerCapture: method(function () {}),
  releasePointerCapture: method(function () {}),
  hasPointerCapture: method(function () {
    return hasCapture(this);
  }),

  addEventListener: method(function (type: string, listener: Listener, options?: unknown) {
    listen(this, type, listener, options, (heard) => attachNatively(this, type, heard, core));
  }),
  removeEventListener: method(function (type: string, listener: Listener, options?: unknown) {
    unlisten(this, type, listener, options);
  }),
  // An event a script sends: to the listeners of the node and of what it is in, in the DOM's
  // order. See `events.ts`.
  dispatchEvent: method(function (event: unknown) {
    return dispatch(event, eventPath(engineOf(this), this));
  }),
});
