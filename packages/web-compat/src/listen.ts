import type { Engine, EngineNode } from '@ng-native/fabric';
import type { RendererExtension } from '@ng-native/platform';
import { documentOf } from './document.ts';
import { created } from './elements.ts';

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
  created,
  listen(target, eventName, callback, engine) {
    const document = documentOf(engine);
    if (!document) return undefined;
    if (typeof target === 'string') {
      if (target !== 'body') return undefined;
      return engine.setEventListener(document.body, topLevel(eventName), callback);
    }
    if (eventName !== 'click' || PRESSABLES.has(target.name)) return undefined;
    return onClick(engine, target, callback);
  },
};

type Listener = (event: unknown) => boolean | void;

/** Whether the node has HTML's `disabled`, on which a browser delivers no click. */
function disabled(node: EngineNode): boolean {
  const value = node.props['disabled'];
  return value != null && value !== false && value !== 'false';
}

/** Each node's click listeners, with what stops its responder: a node has one responder. */
const clicks = new WeakMap<EngineNode, { listeners: Set<Listener>; stop: () => void }>();

/** Add a click listener to a node, which takes the touch for as long as it has one. */
function onClick(engine: Engine, node: EngineNode, listener: Listener): () => void {
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
  const { listeners, stop } = entry;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size || clicks.get(node) !== entry) return;
    clicks.delete(node);
    stop();
  };
}

const topLevel = (type: string) => 'top' + type.charAt(0).toUpperCase() + type.slice(1);

/** The event a `click` listener is given. */
function click(target: EngineNode, nativeEvent: unknown): object {
  return {
    type: 'click',
    target,
    currentTarget: target,
    nativeEvent,
    defaultPrevented: false,
    preventDefault() {},
    stopPropagation() {},
  };
}
