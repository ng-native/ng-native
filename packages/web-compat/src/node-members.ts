import type { Engine, EngineNode } from '@ng-native/fabric';
import type { Renderer2 } from '@angular/core';
import { classAttribute, classListOf, setClassAttribute } from './class-list.ts';
import { documentOf, eventPath, nameOf } from './document.ts';
import { domError, required, withLength } from './dom-error.ts';
import { dispatch, listen, unlisten, type Heard } from './events.ts';
import { listenNatively, hasCapture, topLevel } from './listen.ts';
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

/** The kind of node a value is, where it is one of the engine's. */
const isNode = (value: unknown): value is EngineNode =>
  !!value && typeof value === 'object' && 'nodeKind' in value && 'childList' in value;

/** The node a method is handed, or the error a browser throws for anything else. */
function nodeGiven(value: unknown, method: string): EngineNode {
  if (isNode(value)) return value;
  throw new TypeError(`Failed to execute '${method}': parameter 1 is not of type 'Node'.`);
}

/** Refuse to put a node inside itself, or inside what it holds. */
function checkPlace(parent: EngineNode, child: EngineNode): void {
  for (let at: EngineNode | null = parent; at; at = at.parent) {
    if (at === child) {
      throw domError('The new child contains the parent.', 'HierarchyRequestError');
    }
  }
}

const sibling = (node: EngineNode, by: number): EngineNode | null => {
  const siblings = node.parent?.childList ?? [];
  const at = siblings.indexOf(node);
  return at === -1 ? null : (siblings[at + by] ?? null);
};

/** The nearest element before or after a node under its parent, past any text between. */
function elementBeside(node: EngineNode, step: 1 | -1): EngineNode | null {
  const all = node.parent?.childList ?? [];
  for (let at = all.indexOf(node) + step; at >= 0 && at < all.length; at += step) {
    if (all[at]!.nodeKind === 'element') return all[at]!;
  }
  return null;
}

const textOf = (node: EngineNode): string =>
  node.nodeKind === 'element' ? node.childList.map(textOf).join('') : node.nodeText;

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

/**
 * The DOM members every engine node answers to, for `extendNodes`. `core` is the node prototype
 * as it was: its listeners are what Angular's `@defer` triggers go through, and still do.
 */
export const nodeMembers = (core: CoreNode): PropertyDescriptorMap => ({
  // Upper case, as the DOM has an HTML element's: a library walking up stops at `HTML` or `BODY`.
  nodeName: get(function () {
    if (this.nodeKind === 'anchor') return '#comment';
    if (this.nodeKind === 'text') return '#text';
    return domName(this);
  }),
  // An element's own name, as `nodeName` gives it: the DOM has none for a text or a comment.
  tagName: get(function () {
    return this.nodeKind === 'element' ? domName(this) : undefined;
  }),
  localName: get(function () {
    return this.nodeKind === 'element' ? nameOf(this, engineOf(this)) : null;
  }),
  // The kind of node it is: the engine says an element of everything, for Angular's own check.
  nodeType: get(function () {
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
      engineOf(this).setProp(this, 'nativeID', value);
    },
  ),

  setAttribute: method(function (...args: unknown[]) {
    required(args, 2, 'setAttribute');
    const name = String(args[0]);
    const value = String(args[1]);
    if (name === 'class') return setClassAttribute(this, value);
    noteWritten(this, name, value);
    setAsWritten(this, name, attributeValue(name, value));
  }),
  getAttribute: method(function (name: unknown) {
    return attributeOf(this, String(name));
  }),
  hasAttribute: method(function (name: unknown) {
    return hasAttribute(this, String(name));
  }),
  removeAttribute: method(function (given: unknown) {
    const name = String(given);
    if (name === 'class') return setClassAttribute(this, null);
    if (!hasAttribute(this, name)) return;
    noteWritten(this, name, null);
    setAsWritten(this, name, null);
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

  // The root is in the document, which is what a walk up from any node ends at.
  parentNode: get(function () {
    if (this.parent) return this.parent;
    const engine = engineOf(this);
    return (engine.root === this && documentOf(engine)) || null;
  }),
  parentElement: get(function () {
    return this.parent;
  }),
  firstChild: get(function () {
    return this.childList[0] ?? null;
  }),
  lastChild: get(function () {
    return this.childList.at(-1) ?? null;
  }),
  firstElementChild: get(function () {
    return this.childList.find((child) => child.nodeKind === 'element') ?? null;
  }),
  lastElementChild: get(function () {
    return [...this.childList].reverse().find((child) => child.nodeKind === 'element') ?? null;
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
  isConnected: get(function () {
    let at: EngineNode = this;
    while (at.parent) at = at.parent;
    return at === engineOf(this).root;
  }),
  contains: method(function (other: EngineNode | null) {
    for (let at = other; at; at = at.parent) if (at === this) return true;
    return false;
  }),
  textContent: get(
    function () {
      return textOf(this);
    },
    function (value) {
      const engine = engineOf(this);
      const text = value == null ? '' : String(value);
      if (this.nodeKind === 'text') return engine.setText(this, text);
      if (this.nodeKind === 'anchor') return void (this.nodeText = text);
      // An element's text is all it holds: one text node, kept when it is all there already is,
      // and none for no text.
      const [only] = this.childList;
      if (text && this.childList.length === 1 && only!.nodeKind === 'text') {
        return engine.setText(only!, text);
      }
      for (const child of [...this.childList]) engine.removeChild(this, child);
      if (text) engine.appendChild(this, engine.createText(text));
    },
  ),
  // The words of a text or a comment, and nothing of an element's, which is left as it is.
  nodeValue: get(
    function () {
      return this.nodeKind === 'element' ? null : this.nodeText;
    },
    function (value) {
      if (this.nodeKind === 'element') return;
      this['textContent'] = (value === null ? '' : value) as never;
    },
  ),
  // The page's document, for a node of an app that asked for one.
  ownerDocument: get(function () {
    return documentOf(engineOf(this)) ?? null;
  }),

  appendChild: method(function (value: unknown) {
    const child = nodeGiven(value, 'appendChild');
    checkPlace(this, child);
    engineOf(this).appendChild(this, child);
    return child;
  }),
  insertBefore: method(
    withLength(2, function (this: EngineNode, ...args: unknown[]) {
      required(args, 2, 'insertBefore');
      const child = nodeGiven(args[0], 'insertBefore');
      const before = (args[1] ?? null) as EngineNode | null;
      if (before !== null && before.parent !== this) {
        throw domError(
          'The node before which to insert is not a child of this node.',
          'NotFoundError',
        );
      }
      checkPlace(this, child);
      // Before itself is where it is: before what comes after it.
      engineOf(this).insertBefore(this, child, before === child ? sibling(child, 1) : before);
      return child;
    }),
  ),
  removeChild: method(function (value: unknown) {
    const child = nodeGiven(value, 'removeChild');
    if (child.parent !== this) {
      throw domError('The node to be removed is not a child of this node.', 'NotFoundError');
    }
    engineOf(this).removeChild(this, child);
    return child;
  }),
  remove: method(function () {
    if (this.parent) engineOf(this).removeChild(this.parent, this);
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
