import type { Engine, EngineNode } from '@ng-native/fabric';
import type { RendererExtension } from '@ng-native/platform';
import { documentOf } from './document.ts';
import { setLabel } from './label.ts';
import { created } from './elements.ts';
import { FIELD_EVENTS, createField, isField, setField } from './field.ts';

/** Elements whose own component already turns a touch into a press. */
const PRESSABLES = new Set(['pressable', 'touchable-opacity']);

/**
 * How a listener a web library adds is attached, in an app that asked for this package.
 *
 * - `'body'` is the document's body. `'window'` and `'document'` stay with the renderer, which
 *   attaches them to nothing.
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
    // HTML's `hidden`: the element takes no space and draws nothing, whatever its stylesheet says
    // of its display, which is what a browser's own sheet and every reset make of it.
    if (name === 'hidden' && documentOf(engine)) {
      const hidden = value != null && value !== false && value !== 'false';
      engine.setProp(node, 'style', { ...inlineStyle(node), display: hidden ? 'none' : undefined });
      return true;
    }
    // An HTML `id` is the view's `nativeID`, which is where a selector and a lookup read it.
    if (name === 'id' && documentOf(engine)) {
      engine.setProp(node, 'nativeID', value);
      return true;
    }
    return setField(node, name, value, engine) || setLabel(node, name, value, engine);
  },
  listen(target, eventName, callback, engine) {
    const document = documentOf(engine);
    if (!document) return undefined;
    if (typeof target === 'string') {
      if (target !== 'body') return undefined;
      return engine.setEventListener(document.body, topLevel(eventName), callback);
    }
    const native = isField(target) ? FIELD_EVENTS[eventName] : undefined;
    if (native) {
      return engine.setEventListener(target, native, (event) =>
        callback(dom(eventName, target, event)),
      );
    }
    if (eventName !== 'click' || PRESSABLES.has(target.name)) return undefined;
    return onClick(engine, target, callback);
  },
};

/** A node's inline style, to add to. */
const inlineStyle = (node: EngineNode) =>
  (node.props['style'] as Record<string, unknown> | undefined) ?? {};

type Listener = (event: unknown) => boolean | void;

/** Whether the node has HTML's `disabled`, on which a browser delivers no click. */
function disabled(node: EngineNode): boolean {
  const value = node.props['disabled'];
  return value != null && value !== false && value !== 'false';
}

/** Each node's click listeners, with what stops its responder: a node has one responder. */
const clicks = new WeakMap<EngineNode, { listeners: Set<Listener>; stop: () => void }>();

/** The node's click listeners, behind a responder it gets the first time it is asked for. */
function clicksOf(
  engine: Engine,
  node: EngineNode,
): { listeners: Set<Listener>; stop: () => void } {
  let entry = clicks.get(node);
  if (!entry) {
    const listeners = new Set<Listener>();
    const stop = engine.setResponder(node, {
      onStartShouldSetResponder: () => !disabled(node),
      onResponderRelease: (event) => {
        if (disabled(node)) return;
        const pressed = click(node, event);
        // A copy: a listener may remove itself, or another, as it runs.
        for (const each of [...listeners]) each(pressed);
      },
    });
    clicks.set(node, (entry = { listeners, stop }));
  }
  return entry;
}

/**
 * Have a node take the touch whether or not anything listens for its click, as a button or a
 * link does in a browser: it is `:active` while held, which is where its pressed style comes from.
 */
export function takesPress(engine: Engine, node: EngineNode): void {
  held.add(clicksOf(engine, node));
}

/** The entries `takesPress` made, which keep their responder with no listener left. */
const held = new WeakSet<object>();

/** Add a click listener to a node, which takes the touch for as long as it has one. */
function onClick(engine: Engine, node: EngineNode, listener: Listener): () => void {
  const entry = clicksOf(engine, node);
  const { listeners, stop } = entry;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size || held.has(entry) || clicks.get(node) !== entry) return;
    clicks.delete(node);
    stop();
  };
}

const topLevel = (type: string) => 'top' + type.charAt(0).toUpperCase() + type.slice(1);

/** The event a `click` listener is given. */
const click = (target: EngineNode, nativeEvent: unknown): object =>
  dom('click', target, nativeEvent);

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
