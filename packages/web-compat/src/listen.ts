import type { Engine, EngineNode } from '@ng-native/fabric';
import type { RendererExtension } from '@ng-native/platform';
import { documentOf, listenAnywhere, type CompatDocument } from './document.ts';
import { giveRole, scrollWhereStyled } from './elements.ts';
import { listen, type Heard } from './events.ts';
import { buildAs, setMarkup } from './html.ts';
import { inlineStyle } from './inline-style.ts';
import { styleMade } from './runtime-style.ts';
import { together } from './mutation-observer.ts';

/** Elements whose own component already turns a touch into a press. */
const PRESSABLES = new Set(['pressable', 'touchable-opacity']);

/** The native event a listener's own element is being told, while it is told it. */
let current: unknown;

/** The native event an element's listener is being told now: see `listenAnywhere`. */
export const delivering = (): unknown => current;

/** Tell an element's listener of a native event, which is the one being delivered until it is told. */
function deliverAs<T>(event: unknown, tell: () => T): T {
  const outer = current;
  current = event;
  try {
    return tell();
  } finally {
    current = outer;
  }
}

/**
 * What an attribute or a property of any element is set as, in an app that asked for the
 * package. Each answers whether that is all of it.
 */
const SETTERS: Readonly<
  Record<string, (node: EngineNode, value: unknown, engine: Engine) => boolean>
> = {
  // A binding to `textContent` replaces what the element holds with the text.
  textContent(node, value) {
    (node as unknown as { textContent: unknown }).textContent = value;
    return true;
  },
  // A binding to `innerHTML` replaces what the element holds with what the markup is.
  innerHTML(node, value, engine) {
    together(node, () => setMarkup(node, value, engine));
    return true;
  },
  // HTML's `hidden` bound to `false` is no attribute: the element has none to read back. A
  // hidden element is drawn as `display: none`: see `hide`.
  hidden(node, value, engine) {
    engine.setProp(node, 'hidden', value === false ? null : value);
    hide(node, on(value) && value !== 'until-found', engine);
    return true;
  },
  // An HTML `id` is the view's `nativeID`, which is where a lookup reads it.
  id(node, value, engine) {
    engine.setProp(node, 'nativeID', value);
    return true;
  },
};

/**
 * How a listener a web library adds is attached, in an app that asked for this package.
 *
 * - `'window'`, `'document'` and `'body'` hear a press anywhere in the app.
 * - A `click` is a press: the node takes the touch as a pressable does, and the listener runs when
 *   the finger lifts. Native has no click of its own for a view to hear.
 *
 * ponytail: a lift outside the node still clicks, and nothing is highlighted while it is held.
 * A pressable's own hit testing is the upgrade.
 */
export const webListen: RendererExtension = {
  // A button and a link have their roles: see `elements.ts`.
  created(node, engine) {
    giveRole(node, engine);
    // What overflows it scrolls, where its style says so: see `elements.ts`.
    scrollWhereStyled(node, engine);
    // A stylesheet is read, and has no box of its own: see `runtime-style.ts`.
    if (node.tag === 'style' && documentOf(engine)) styleMade(node, engine);
  },
  set(node, name, value, engine) {
    const own = documentOf(engine) ? SETTERS[name] : undefined;
    return own ? own(node, value, engine) : false;
  },
  // A style a library binds is set as what a native view reads: see `inline-style.ts`.
  style(node, name, value, engine) {
    return documentOf(engine) ? inlineStyle(node, name, value) : undefined;
  },
  // Kept as `addEventListener` keeps a listener, so what a script sends reaches a template's too.
  listen(target, eventName, callback, engine) {
    const document = documentOf(engine);
    if (!document) return undefined;
    const on = listenedOn(target, document);
    // An element native says nothing of the event for is given it by the name native would.
    const node = typeof target !== 'string' && on !== globalThis && on !== document;
    const attach = (heard: Heard) =>
      listenNatively(target, eventName, heard, engine) ??
      (node
        ? engine.setEventListener(target as EngineNode, topLevel(eventName), heard)
        : undefined);
    return listen(on, eventName, callback, undefined, attach) ?? (() => {});
  },
};

// What markup builds is given what a template's elements are, as they are made: see `html-tree.ts`.
buildAs(webListen);

/** What a template's listener is on: Angular names the window, the document and the body. */
function listenedOn(target: EngineNode | string, document: CompatDocument): EngineNode | object {
  if (typeof target !== 'string') return target;
  if (target === 'window') return globalThis;
  return target === 'body' ? document.body : document;
}

export const topLevel = (name: string) => 'top' + name.charAt(0).toUpperCase() + name.slice(1);

/**
 * Attach a listener to what native says for an event: on `window`, `document` and `body` a
 * press anywhere, and on an element what it says itself. Nothing where native says nothing of
 * the event.
 */
export function listenNatively(
  target: EngineNode | string,
  eventName: string,
  callback: Heard,
  engine: Engine,
): (() => void) | undefined {
  const document = documentOf(engine);
  if (!document) return undefined;
  // `window`, `document` and `body` by name, or the objects themselves, which is what a library
  // that holds one hands the renderer.
  const anywhere = typeof target === 'string' || target === (globalThis as unknown);
  if (anywhere || target === document.body || target === (document as unknown)) {
    return listenAnywhere(engine, eventName, callback);
  }
  return listenOn(engine, target, eventName, callback);
}

/** Listen on one element: a touch as a pointer or a click, or a native event by its name. */
function listenOn(
  engine: Engine,
  target: EngineNode,
  eventName: string,
  callback: Heard,
): (() => void) | undefined {
  if (POINTER_EVENTS.has(eventName)) return onTouch(engine, target, eventName, callback);
  const native = NATIVE_NAMES[eventName];
  if (native) {
    return engine.setEventListener(target, native, (event) =>
      deliverAs(event, () => callback(dom(eventName, target, event))),
    );
  }
  if (eventName !== 'click' || PRESSABLES.has(target.tag)) return undefined;
  return onTouch(engine, target, 'click', callback);
}

/** A boolean HTML attribute or property: present, and not `false`. */
const on = (value: unknown): boolean => value != null && value !== false && value !== 'false';

/** The `display` each hidden element had of its own before it was hidden, as `{ display }`. */
const shownAs = new WeakMap<EngineNode, { readonly display: unknown }>();

/**
 * HTML's `hidden`: the element takes no space and draws nothing, whatever a stylesheet says of
 * its display, which is what a browser's own sheet and every reset make of it. Shown again, it
 * has the display of its own it had, or none.
 *
 * ponytail: `until-found` keeps its box, as a browser has it, and is drawn too, where a browser
 * skips what is in it. A collapsible gives it no height and clips it while it is closed, and
 * measures it as it opens. And a display a binding sets while it is hidden shows it.
 */
function hide(node: EngineNode, gone: boolean, engine: Engine): void {
  const had = shownAs.get(node);
  if (gone === (had !== undefined)) return;
  const style = { ...(node.props['style'] as Record<string, unknown> | undefined) };
  if (gone) {
    shownAs.set(node, { display: style['display'] });
    style['display'] = 'none';
  } else {
    shownAs.delete(node);
    if (had!.display === undefined) delete style['display'];
    else style['display'] = had!.display;
  }
  engine.setProp(node, 'style', style);
}

/** Whether an element is disabled, which takes no press: a browser sends it no click. */
const disabled = (node: EngineNode): boolean => on(node.props['disabled']);

/**
 * Events a browser has another name for than native does. A finger on an element is what a
 * library listens for where it knows it is on a phone, as Material's tooltip does.
 *
 * ponytail: `focusin` and `focusout` are heard on the element that has the focus, and do not go
 * on up to the elements it is in. Send them up as a click is if a library listens from above.
 */
const NATIVE_NAMES: Readonly<Record<string, string>> = {
  scroll: 'topScroll',
  touchstart: 'topTouchStart',
  touchmove: 'topTouchMove',
  touchend: 'topTouchEnd',
  touchcancel: 'topTouchCancel',
  focusin: 'topFocus',
  focusout: 'topBlur',
  focus: 'topFocus',
  blur: 'topBlur',
};

/** The events a touch is delivered as, beside the `click` its release is. */
const POINTER_EVENTS = new Set(['pointerdown', 'pointermove', 'pointerup', 'pointercancel']);

/** How far a finger may drift in a press: the platforms' own. Further is a drag. */
const SLOP = 10;

type Listener = (event: unknown) => boolean | void;

/** A node's listeners by event type, with what stops its responder: a node has one responder. */
interface Touched {
  readonly listeners: Map<string, Set<Listener>>;
  readonly stop: () => void;
}

const touched = new WeakMap<EngineNode, Touched>();

/**
 * The nodes a touch is on: the one that took it and the one it landed on. A touch goes to the node
 * that took it until it ends, which is what a pointer capture asks a browser for.
 */
const capturing = new WeakSet<EngineNode>();

/** Whether a touch is on the node, and so every move of it comes to the node's listeners. */
export const hasCapture = (node: EngineNode): boolean => capturing.has(node);

/** Where on the screen a touch is. */
function pointOf(event: unknown): { x: number; y: number } {
  const touch = (event as { nativeEvent?: { pageX?: number; pageY?: number } }).nativeEvent;
  return { x: touch?.pageX ?? 0, y: touch?.pageY ?? 0 };
}

/** The node's listeners, behind a responder it gets the first time it is asked for. */
function touchedOf(engine: Engine, node: EngineNode): Touched {
  let entry = touched.get(node);
  if (entry) return entry;
  const listeners = new Map<string, Set<Listener>>();
  /** Where the touch landed: the node, or one inside it with no responder of its own. */
  let landed = node;
  let down = { x: 0, y: 0 };
  /** Whether the finger went further than a press does: a drag, which ends in no click. */
  let dragged = false;
  const tell = (type: string, event: unknown) => {
    const told = listeners.get(type);
    if (!told?.size && type !== 'click') return;
    // A click is a pointer event too, on the node that took the touch.
    const sent = pointer(type, type === 'click' ? node : landed, node, event) as Bubbling;
    deliverAs(event, () => deliver(node, type, told, sent));
  };
  const over = (type: string, event: unknown) => {
    tell(type, event);
    capturing.delete(node);
    capturing.delete(landed);
  };
  const stop = engine.setResponder(node, {
    onStartShouldSetResponder: (_event, target) => {
      if (disabled(node)) return false;
      landed = target ?? node;
      return true;
    },
    onResponderGrant: (event) => {
      capturing.add(node);
      capturing.add(landed);
      dragged = false;
      down = pointOf(event);
      tell('pointerdown', event);
    },
    onResponderMove: (event) => {
      const at = pointOf(event);
      if (Math.hypot(at.x - down.x, at.y - down.y) > SLOP) dragged = true;
      tell('pointermove', event);
    },
    onResponderRelease: (event) => {
      over('pointerup', event);
      // A drag is not a press: a list moved under a finger is not the option it was lifted from.
      const at = pointOf(event);
      dragged ||= Math.hypot(at.x - down.x, at.y - down.y) > SLOP;
      if (!disabled(node) && !dragged) tell('click', event);
    },
    onResponderTerminate: (event) => over('pointercancel', event),
  });
  touched.set(node, (entry = { listeners, stop }));
  return entry;
}

interface Bubbling {
  currentTarget: EngineNode;
  stopped?: boolean;
  defaultPrevented?: boolean;
}

/** Tell a node's listeners of what a touch was, and those above it of a click or a pointer down. */
function deliver(node: EngineNode, type: string, told: Set<Listener> | undefined, sent: Bubbling) {
  // A copy: a listener may remove itself, or another, as it runs.
  for (const each of [...(told ?? [])]) each(sent);
  // A click bubbles, and so does a pointer coming down, which is where a drag starts: an area
  // told of it follows the finger from the document, though it came down on a thumb inside it.
  if (type === 'click' || type === 'pointerdown') bubble(node, sent, type);
}

/**
 * Send a click or a pointer down on up the tree, to each node over the one that took the touch
 * that listens for one, until a listener stops it: only one node takes a touch, and a browser's
 * click is heard by every box it is in.
 */
function bubble(from: EngineNode, event: Bubbling, type: string): void {
  for (let up = from.parent; up && !event.stopped; up = up.parent) {
    const told = touched.get(up)?.listeners.get(type);
    if (!told?.size || disabled(up)) continue;
    event.currentTarget = up;
    for (const each of [...told]) each(event);
  }
}

/** Add a click or pointer listener to a node, which takes the touch for as long as it has one. */
function onTouch(engine: Engine, node: EngineNode, type: string, listener: Listener): () => void {
  const entry = touchedOf(engine, node);
  const { listeners, stop } = entry;
  let told = listeners.get(type);
  if (!told) listeners.set(type, (told = new Set()));
  told.add(listener);
  return () => {
    told.delete(listener);
    const left = [...listeners.values()].some((each) => each.size);
    if (left || touched.get(node) !== entry) return;
    touched.delete(node);
    stop();
  };
}

interface Touch {
  identifier?: number;
  pageX?: number;
  pageY?: number;
}

/** A touch as a DOM `Touch` reads: the page and the client both, with no window to scroll. */
const asTouch = (touch: Touch): object => ({
  ...touch,
  clientX: touch.pageX ?? 0,
  clientY: touch.pageY ?? 0,
});

/**
 * Where a touch is, as a DOM event says it: the finger that changed at the page and the client,
 * and the fingers down as `touches`.
 */
export function touchFields(native: unknown): Record<string, unknown> {
  const said = native as
    { pageX?: number; pageY?: number; touches?: Touch[]; changedTouches?: Touch[] } | undefined;
  if (!said) return {};
  const x = said.pageX ?? 0;
  const y = said.pageY ?? 0;
  return {
    clientX: x,
    clientY: y,
    pageX: x,
    pageY: y,
    touches: (said.touches ?? []).map(asTouch),
    changedTouches: (said.changedTouches ?? []).map(asTouch),
  };
}

/** A pointer event as a listener reads one: where the finger is, and which pointer it is. */
function pointer(type: string, target: EngineNode, current: EngineNode, event: unknown): object {
  const touch = (event as { nativeEvent?: { identifier?: number } }).nativeEvent;
  return {
    ...dom(type, target, event),
    currentTarget: current,
    pointerId: touch?.identifier ?? 0,
    pointerType: 'touch',
    isPrimary: true,
    // How many presses a click is, which is none for a pointer event.
    detail: type === 'click' ? 1 : 0,
    button: 0,
    buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  };
}

/** What native said of events a listener has cancelled. */
const cancelled = new WeakSet<object>();

/** A DOM event as a listener reads one: its type, its target, and the native event behind it. */
function dom(type: string, target: EngineNode, event: unknown): Record<string, unknown> {
  // What native said, which every element the event goes up through is told of.
  const native = (event as { nativeEvent?: object } | undefined)?.nativeEvent;
  return {
    ...touchFields(native),
    type,
    // What the event was sent to, which a listener on a box around it tells from that box.
    target: (event as { target?: EngineNode | null } | undefined)?.target ?? target,
    currentTarget: target,
    nativeEvent: event,
    defaultPrevented: cancelled.has(native ?? {}),
    preventDefault(this: { defaultPrevented?: boolean }) {
      this.defaultPrevented = true;
      if (native) cancelled.add(native);
    },
    stopPropagation(this: { stopped?: boolean }) {
      this.stopped = true;
      // And the native event the engine carries on up to the boxes around the target.
      (event as { stopPropagation?(): void } | undefined)?.stopPropagation?.();
    },
  };
}
