import type { Engine, EngineNode } from '@ng-native/fabric';
import { propOf } from './attribute.ts';
import { documentOf, ownView } from './document.ts';
import { setField, valueOf } from './field.ts';
import { inlineStyle } from './inline-style.ts';
import { hasCapture, webListen } from './listen.ts';
import { descendants, matches } from './selector.ts';

/** A node as a library holds one: an engine node with the members below on it. */
type Dom = EngineNode & Record<string, (...args: unknown[]) => unknown>;
type Listener = (event: unknown) => void;

const engineOf = (node: EngineNode): Engine => (node as unknown as { host: Engine }).host;
const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const topLevel = (type: string) => 'top' + type.charAt(0).toUpperCase() + type.slice(1);
const classesOf = (node: EngineNode) => (node.classes ? [...node.classes].join(' ') : '');
const textOf = (node: EngineNode): string =>
  node.kind === 'text' ? node.text : node.children.map(textOf).join('');
const sibling = (node: EngineNode, by: number) => {
  const siblings = node.parent?.children;
  return siblings?.[siblings.indexOf(node) + by] ?? null;
};

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

/** What was set on `element.style` where the view was given something else, to read back. */
const written = new WeakMap<EngineNode, Map<string, unknown>>();

/** A bare number or a length in pixels, as the number a view reads. */
const plain = (value: unknown): unknown =>
  typeof value === 'string' && /^-?[\d.]+(px)?$/.test(value) ? parseFloat(value) : value;

/**
 * `element.style`: reads and writes of the node's inline style, by either spelling of a name.
 * A write is CSS, as a bound style is, and is set as what the view reads; a read of one that
 * was set as something else answers what was written.
 */
function styleOf(node: EngineNode): Record<string, unknown> {
  const engine = engineOf(node);
  const current = () => (node.props['style'] as Record<string, unknown> | undefined) ?? {};
  const write = (key: string, value: unknown) => {
    const gone = value === '' || value == null;
    const as = inlineStyle(node, key, gone ? null : value);
    const kept = written.get(node) ?? written.set(node, new Map()).get(node)!;
    if (as && !gone) kept.set(key, value);
    else kept.delete(key);
    const next = { ...current() };
    for (const [name, set] of Object.entries(as ?? { [key]: gone ? null : value })) {
      if (set == null) delete next[name];
      else next[name] = plain(set);
    }
    engine.setProp(node, 'style', next);
  };
  const read = (key: string) => written.get(node)?.get(key) ?? current()[key] ?? '';
  const methods: Record<string, unknown> = {
    setProperty: (name: string, value: unknown) =>
      name.startsWith('--')
        ? engine.setCustomProperty(node, name, value)
        : write(camel(name), value),
    removeProperty: (name: string) => write(camel(name), null),
    getPropertyValue: (name: string) => String(read(camel(name))),
  };
  return new Proxy(methods, {
    get: (target, key) => (key in target ? target[key as string] : read(key as string)),
    set: (_, key, value) => (write(String(key), value), true),
  });
}

/** The event types core's own `addEventListener` attaches, for `@defer`. */
const DEFER_TRIGGERS = new Set(['click', 'keydown', 'mouseenter', 'focusin']);

/** Where native last laid a node out, in the window. Zero for one it has not. */
function frameOf(node: EngineNode) {
  const engine = engineOf(node);
  // The root is the window: native has no view of its own to measure for it.
  if (node === engine.root) return { x: 0, y: 0, ...engine.viewport };
  let frame = { x: 0, y: 0, width: 0, height: 0 };
  // Fabric answers before `measure` returns, so this reads as a DOM measurement does.
  engine.measure(node, (measured) => (frame = measured));
  return frame;
}

/** The extent of what a node holds, which is more than its own frame when it clips. */
function contentOf(node: EngineNode) {
  const own = frameOf(node);
  let right = own.x + own.width;
  let bottom = own.y + own.height;
  for (const child of node.children) {
    if (child.kind !== 'element') continue;
    const frame = frameOf(child);
    right = Math.max(right, frame.x + frame.width);
    bottom = Math.max(bottom, frame.y + frame.height);
  }
  return { width: right - own.x, height: bottom - own.y };
}

/** The empty box each `<template>` hands back as its content. */
const placeholders = new WeakMap<EngineNode, EngineNode>();

/** What removes each listener `addEventListener` attached, by node, type and function. */
const listeners = new WeakMap<EngineNode, Map<string, Map<Listener, () => void>>>();

const get = (read: (this: Dom) => unknown, write?: (this: Dom, value: unknown) => void) => ({
  get: read,
  set: write,
});
const method = (value: (this: Dom, ...args: never[]) => unknown) => ({ value, writable: true });
const noop = method(function () {});
const zero = get(
  () => 0,
  () => {},
);

/** What a node has in core that the members below take the place of. */
export interface CoreNode {
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}

/**
 * The DOM members every engine node answers to, for `extendNodes`. `core` is the node prototype
 * as it was: its listeners are what Angular's `@defer` triggers go through, and still do.
 */
export const nodeMembers = (core: CoreNode): PropertyDescriptorMap => ({
  nodeName: get(function () {
    return this.kind === 'text'
      ? '#text'
      : this.kind === 'anchor'
        ? '#comment'
        : this.name.toUpperCase();
  }),
  // Upper case, as the DOM has an HTML element's: a library tells a button by `=== 'BUTTON'`.
  tagName: get(function () {
    return this.name.toUpperCase();
  }),
  localName: get(function () {
    return this.name;
  }),
  id: get(
    function () {
      return this.props['nativeID'] ?? '';
    },
    function (value) {
      engineOf(this).setProp(this, 'nativeID', value);
    },
  ),

  // A text field's text. Not on any other element, where a library tells the two apart by it.
  value: get(
    function () {
      return valueOf(this);
    },
    function (value) {
      setField(this, 'value', value, engineOf(this));
    },
  ),

  setAttribute: method(function (name: string, value: unknown) {
    if (name === 'class') engineOf(this).setClasses(this, String(value));
    else engineOf(this).setProp(this, propOf(name), attributeValue(name, String(value)));
  }),
  getAttribute: method(function (name: string) {
    if (name === 'class') return this.classes ? classesOf(this) : null;
    const value = this.props[propOf(name)];
    return value == null ? null : String(value);
  }),
  hasAttribute: method(function (name: string) {
    return name === 'class' ? !!this.classes?.size : this.props[propOf(name)] != null;
  }),
  removeAttribute: method(function (name: string) {
    if (name === 'class') engineOf(this).setClasses(this, '');
    else if (propOf(name) in this.props) engineOf(this).setProp(this, propOf(name), null);
  }),
  toggleAttribute: method(function (name: string, force?: boolean) {
    const on = force ?? !this['hasAttribute']!(name);
    if (on) this['setAttribute']!(name, '');
    else this['removeAttribute']!(name);
    return on;
  }),
  getAttributeNames: method(function () {
    return Object.keys(this.props)
      .filter((key) => key !== 'style')
      .map((key) => (key === 'nativeID' ? 'id' : key));
  }),

  classList: get(function () {
    const node = this;
    const engine = engineOf(node);
    const toggle = (name: string, force?: boolean) => {
      const on = force ?? !node.classes?.has(name);
      if (on) engine.addClass(node, name);
      else engine.removeClass(node, name);
      return on;
    };
    return {
      add: (...names: string[]) => names.forEach((name) => engine.addClass(node, name)),
      remove: (...names: string[]) => names.forEach((name) => engine.removeClass(node, name)),
      contains: (name: string) => !!node.classes?.has(name),
      toggle,
      get length() {
        return node.classes?.size ?? 0;
      },
      [Symbol.iterator]: () => (node.classes ?? new Set<string>()).values(),
    };
  }),
  className: get(
    function () {
      return classesOf(this);
    },
    function (value) {
      engineOf(this).setClasses(this, String(value));
    },
  ),
  style: get(function () {
    return styleOf(this);
  }),

  parentNode: get(function () {
    return this.parent;
  }),
  parentElement: get(function () {
    return this.parent;
  }),
  childNodes: get(function () {
    return this.children;
  }),
  firstChild: get(function () {
    return this.children[0] ?? null;
  }),
  lastChild: get(function () {
    return this.children.at(-1) ?? null;
  }),
  firstElementChild: get(function () {
    return this.children.find((child) => child.kind === 'element') ?? null;
  }),
  nextSibling: get(function () {
    return sibling(this, 1);
  }),
  previousSibling: get(function () {
    return sibling(this, -1);
  }),
  isConnected: get(function () {
    let at: EngineNode = this;
    while (at.parent) at = at.parent;
    return at === engineOf(this).root;
  }),
  textContent: get(
    function () {
      return textOf(this);
    },
    function (value) {
      const engine = engineOf(this);
      const text = value == null ? '' : String(value);
      if (this.kind === 'text') return engine.setText(this, text);
      // An element's text is all it holds: one text node, kept when it is all there already is.
      const [only] = this.children;
      if (this.children.length === 1 && only!.kind === 'text') return engine.setText(only!, text);
      for (const child of [...this.children]) engine.removeChild(this, child);
      if (text) engine.appendChild(this, engine.createText(text));
    },
  ),
  nodeValue: get(function () {
    return this.kind === 'text' ? this.text : null;
  }),

  ownerDocument: get(function () {
    return documentOf(engineOf(this)) ?? null;
  }),
  getRootNode: method(function () {
    return documentOf(engineOf(this)) ?? engineOf(this).root;
  }),
  dataset: get(function () {
    const { props } = this;
    const prop = (key: string | symbol) =>
      `data-${String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`;
    return new Proxy({}, { get: (_, key) => props[prop(key)] });
  }),

  // A touch stays with the node that took it until it ends, so there is no capture to set or to
  // let go: a node has it for as long as the touch is on it.
  setPointerCapture: method(function () {}),
  releasePointerCapture: method(function () {}),
  hasPointerCapture: method(function () {
    return hasCapture(this);
  }),

  getBoundingClientRect: method(function () {
    const { x, y, width, height } = frameOf(this);
    return { x, y, top: y, left: x, right: x + width, bottom: y + height, width, height };
  }),
  offsetWidth: get(function () {
    return frameOf(this).width;
  }),
  clientWidth: get(function () {
    return frameOf(this).width;
  }),
  offsetHeight: get(function () {
    return frameOf(this).height;
  }),
  clientHeight: get(function () {
    return frameOf(this).height;
  }),
  scrollWidth: get(function () {
    return contentOf(this).width;
  }),
  scrollHeight: get(function () {
    return contentOf(this).height;
  }),
  scrollTop: zero,
  scrollLeft: zero,
  blur: noop,
  scrollIntoView: noop,
  dispatchEvent: method(() => true),

  // What a library reads back after setting a `<template>`'s `innerHTML`, as an icon component
  // does with its SVG: an empty box, since markup is not parsed here.
  // ponytail: nothing of the markup is drawn. Building the SVG from it, with the shapes
  // `@ng-native/icons` draws, is the upgrade.
  content: get(function () {
    let placeholder = placeholders.get(this);
    if (!placeholder) placeholders.set(this, (placeholder = ownView(engineOf(this))));
    return { firstElementChild: placeholder, firstChild: placeholder, childNodes: [placeholder] };
  }),

  contains: method(function (other: EngineNode | null) {
    for (let at = other; at; at = at.parent) if (at === this) return true;
    return false;
  }),
  matches: method(function (selector: string) {
    return matches(this, selector);
  }),
  closest: method(function (selector: string) {
    for (let at: EngineNode | null = this; at; at = at.parent) if (matches(at, selector)) return at;
    return null;
  }),
  querySelectorAll: method(function (selector: string) {
    return [...descendants(this)].filter((node) => matches(node, selector));
  }),
  querySelector: method(function (selector: string) {
    for (const node of descendants(this)) if (matches(node, selector)) return node;
    return null;
  }),

  appendChild: method(function (child: EngineNode) {
    engineOf(this).appendChild(this, child);
    return child;
  }),
  insertBefore: method(function (child: EngineNode, before: EngineNode | null) {
    engineOf(this).insertBefore(this, child, before);
    return child;
  }),
  removeChild: method(function (child: EngineNode) {
    engineOf(this).removeChild(this, child);
    return child;
  }),
  remove: method(function () {
    if (this.parent) engineOf(this).removeChild(this.parent, this);
  }),

  addEventListener: method(function (type: string, listener: Listener) {
    // Core maps the events a `@defer` trigger listens for to the native ones that stand for
    // them, and does nothing with any other type: both run, and one of them attaches.
    core.addEventListener.call(this, type, listener);
    if (DEFER_TRIGGERS.has(type)) return;
    let byType = listeners.get(this);
    if (!byType) listeners.set(this, (byType = new Map()));
    let byListener = byType.get(type);
    if (!byListener) byType.set(type, (byListener = new Map()));
    // The DOM adds a listener once, however often it is asked to.
    if (byListener.has(listener)) return;
    // What a template's listener is given, a touch as pointer events or a field's typing as
    // `input`, a listener added here is given too; any other type is the native event of its name.
    const engine = engineOf(this);
    const stop =
      webListen.listen?.(this, type, listener, engine) ??
      engine.setEventListener(this, topLevel(type), listener);
    byListener.set(listener, stop);
  }),
  removeEventListener: method(function (type: string, listener: Listener) {
    core.removeEventListener.call(this, type, listener);
    const byListener = listeners.get(this)?.get(type);
    byListener?.get(listener)?.();
    byListener?.delete(listener);
  }),
});
