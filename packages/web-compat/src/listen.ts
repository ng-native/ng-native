import type { EngineNode } from '@ng-native/fabric';
import type { RendererExtension } from '@ng-native/platform';
import { documentOf } from './document.ts';

/** Elements whose own component already turns a touch into a press. */
const PRESSABLES = new Set(['pressable', 'touchable-opacity', 'button']);

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
  listen(target, eventName, callback, engine) {
    const document = documentOf(engine);
    if (!document) return undefined;
    if (typeof target === 'string') {
      if (target !== 'body') return undefined;
      return engine.setEventListener(document.body, topLevel(eventName), callback);
    }
    if (eventName !== 'click' || PRESSABLES.has(target.name)) return undefined;
    return engine.setResponder(target, {
      onStartShouldSetResponder: () => true,
      onResponderRelease: (event) => void callback(click(target, event)),
    });
  },
};

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
