import type { Engine, EngineNode } from '@ng-native/fabric';
import type { RendererExtension } from '@ng-native/platform';
import { documentOf, heldForMenu, listenAnywhere } from './document.ts';
import { inlineStyle } from './inline-style.ts';
import { setLabel } from './label.ts';
import { created } from './elements.ts';
import { FIELD_EVENTS, createField, isField, setField } from './field.ts';

/** Elements whose own component already turns a touch into a press. */
const PRESSABLES = new Set(['pressable', 'touchable-opacity']);

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
  created(node, engine) {
    if (created(node, engine)) takesPress(engine, node);
    createField(node, engine);
  },
  set(node, name, value, engine) {
    // Markup as a string is nothing a native view reads, and an icon's is long.
    if (name === 'innerHTML') return true;
    // A binding to `textContent` replaces what the element holds with the text.
    if (name === 'textContent' && documentOf(engine)) {
      (node as unknown as { textContent: unknown }).textContent = value;
      return true;
    }
    // HTML's `hidden`: the element takes no space and draws nothing, whatever its stylesheet says
    // of its display, which is what a browser's own sheet and every reset make of it.
    if (name === 'hidden' && documentOf(engine)) {
      const hidden = value != null && value !== false && value !== 'false';
      engine.setProp(node, 'style', { ...ownStyle(node), display: hidden ? 'none' : undefined });
      return true;
    }
    // An HTML `id` is the view's `nativeID`, which is where a selector and a lookup read it.
    if (name === 'id' && documentOf(engine)) {
      engine.setProp(node, 'nativeID', value);
      return true;
    }
    return setField(node, name, value, engine) || setLabel(node, name, value, engine);
  },
  style(node, name, value, engine) {
    return documentOf(engine) ? inlineStyle(node, name, value) : undefined;
  },
  listen(target, eventName, callback, engine) {
    const document = documentOf(engine);
    if (!document) return undefined;
    // `window`, `document` and `body`: a press anywhere. Any other event is left to the
    // renderer, which attaches it to nothing.
    // The body as a node too, which is what a library hands the renderer for the same thing.
    if (typeof target === 'string' || target === document.body) {
      return listenAnywhere(engine, eventName, callback);
    }
    const native = isField(target) ? FIELD_EVENTS[eventName] : undefined;
    if (native) {
      return engine.setEventListener(target, native, (event) =>
        callback(dom(eventName, target, event)),
      );
    }
    if (POINTER_EVENTS.has(eventName)) return onTouch(engine, target, eventName, callback);
    if (eventName !== 'click' || PRESSABLES.has(target.name)) return undefined;
    return onTouch(engine, target, 'click', callback);
  },
};

/** A node's inline style, to add to. */
const ownStyle = (node: EngineNode) =>
  (node.props['style'] as Record<string, unknown> | undefined) ?? {};

type Listener = (event: unknown) => boolean | void;

/** Whether the node has HTML's `disabled`, on which a browser delivers no click. */
function disabled(node: EngineNode): boolean {
  const value = node.props['disabled'];
  return value != null && value !== false && value !== 'false';
}

/** A node's listeners by event type, with what stops its responder: a node has one responder. */
interface Touched {
  readonly listeners: Map<string, Set<Listener>>;
  readonly stop: () => void;
}

const touched = new WeakMap<EngineNode, Touched>();

/** The events a touch is delivered as, beside the `click` its release is. */
const POINTER_EVENTS = new Set([
  ...['pointerdown', 'pointermove', 'pointerup', 'pointercancel'],
  'contextmenu',
]);

/**
 * The nodes a touch is on: the one that took it and the one it landed on. A touch goes to the node
 * that took it until it ends, which is what a pointer capture asks a browser for.
 */
const capturing = new WeakSet<EngineNode>();

/** Whether a touch is on the node, and so every move of it comes to the node's listeners. */
export const hasCapture = (node: EngineNode): boolean => capturing.has(node);

/** How long a finger is held for a context menu, and how far it may drift: the platforms' own. */
const HOLD = 500;
const SLOP = 10;

/** Where on the screen a touch is. */
function pointOf(event: unknown): { x: number; y: number } {
  const touch = (event as { nativeEvent?: { pageX?: number; pageY?: number } }).nativeEvent;
  return { x: touch?.pageX ?? 0, y: touch?.pageY ?? 0 };
}

/** The node's listeners, behind a responder it gets the first time it is asked for. */
function touchedOf(engine: Engine, node: EngineNode): Touched {
  let entry = touched.get(node);
  if (!entry) {
    const listeners = new Map<string, Set<Listener>>();
    /** Where the touch landed: the node, or one inside it with no responder of its own. */
    let landed = node;
    const tell = (type: string, event: unknown) => {
      const told = listeners.get(type);
      if (!told?.size) return;
      // A click is a pointer event too, on the node that took the touch.
      const sent = pointer(type, type === 'click' ? node : landed, node, event);
      // A copy: a listener may remove itself, or another, as it runs.
      for (const each of [...told]) each(sent);
    };
    /** The wait for a finger held still, and whether it ran out: the hold was a context menu. */
    let holding: ReturnType<typeof setTimeout> | undefined;
    let menu = false;
    let down = { x: 0, y: 0 };
    const over = (type: string, event: unknown) => {
      clearTimeout(holding);
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
        tell('pointerdown', event);
        menu = false;
        if (!listeners.get('contextmenu')?.size) return;
        // A finger held where it landed is what asks for a context menu with no second button.
        down = pointOf(event);
        holding = setTimeout(() => {
          menu = true;
          // Until the next touch, wherever it lands.
          heldForMenu.add(engine);
          const stop = engine.setEventListener(engine.root, 'topTouchStart', () => {
            heldForMenu.delete(engine);
            stop();
          });
          tell('contextmenu', event);
        }, HOLD);
      },
      onResponderMove: (event) => {
        const at = pointOf(event);
        if (Math.hypot(at.x - down.x, at.y - down.y) > SLOP) clearTimeout(holding);
        tell('pointermove', event);
      },
      onResponderRelease: (event) => {
        over('pointerup', event);
        // A hold that opened a menu is not a press as well.
        if (!disabled(node) && !menu) tell('click', event);
      },
      onResponderTerminate: (event) => over('pointercancel', event),
    });
    touched.set(node, (entry = { listeners, stop }));
  }
  return entry;
}

/**
 * Have a node take the touch whether or not anything listens for its click, as a button or a
 * link does in a browser: it is `:active` while held, which is where its pressed style comes from.
 */
export function takesPress(engine: Engine, node: EngineNode): void {
  held.add(touchedOf(engine, node));
}

/** The entries `takesPress` made, which keep their responder with no listener left. */
const held = new WeakSet<object>();

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
    if (left || held.has(entry) || touched.get(node) !== entry) return;
    touched.delete(node);
    stop();
  };
}

/**
 * A pointer event as a listener reads one: where the finger is on the screen, which is the page
 * and the client both, with no window to scroll.
 */
function pointer(type: string, target: EngineNode, current: EngineNode, event: unknown): object {
  const touch = (event as { nativeEvent?: { identifier?: number } }).nativeEvent;
  const { x, y } = pointOf(event);
  return {
    ...dom(type, target, event),
    currentTarget: current,
    clientX: x,
    clientY: y,
    pageX: x,
    pageY: y,
    pointerId: touch?.identifier ?? 0,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
    // No key is held with a finger: a listener that leaves a modified click to the browser reads
    // these, as a router's link does.
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  };
}

/** A DOM event as a listener reads one: its type, its target, and the native event behind it. */
function dom(type: string, target: EngineNode, nativeEvent: unknown): object {
  return {
    type,
    target,
    currentTarget: target,
    nativeEvent,
    defaultPrevented: false,
    preventDefault() {},
    stopPropagation() {},
  };
}
