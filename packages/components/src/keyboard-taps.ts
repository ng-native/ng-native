import {
  isTextInput,
  viewNameOf,
  type EngineNode,
  type HostEngine,
  type HostNode,
} from '@ng-native/fabric';

export type KeyboardShouldPersistTaps = 'always' | 'never' | 'handled';

/**
 * What a tap in a scrolling container does while a text input has the keyboard up, which is
 * `ScrollView.js`'s JavaScript in React Native rather than anything native. `never` (the default):
 * a tap anywhere but on a text input is the container's before a child sees it, and all it does is
 * dismiss. `handled`: the child gets first refusal, and the tap dismisses only if nothing took it.
 * `always`: the keyboard stays. A tap on another text input never dismisses, so a form's next
 * field takes the focus with the keyboard still up: React Native's `never` lets any text input's
 * tap through, and with `handled` the text input takes the tap itself.
 *
 * Returns the responder's release, for the container's destroy.
 */
export function dismissKeyboardOnTap(
  engine: HostEngine,
  node: HostNode,
  policy: () => KeyboardShouldPersistTaps,
): () => void {
  let dismissing = false;

  /** A keyboard is up for an input, and the tap is not on a text input or above the keyboard. */
  const tapDismisses = (target: EngineNode): boolean =>
    engine.focusedField !== null && !isTextInput(target) && !inAccessoryBar(target);

  // RN's `_observedScrollSinceBecomingResponder`: a touch that scrolled was a drag, and a drag
  // through the content is reading it, so its release leaves the keyboard up.
  const stopScroll = engine.setEventListener(node, 'topScroll', () => {
    dismissing = false;
  });
  const stopResponder = engine.setResponder(node, {
    onStartShouldSetResponderCapture: (_, target) => policy() === 'never' && tapDismisses(target),
    onStartShouldSetResponder: (_, target) => policy() === 'handled' && tapDismisses(target),
    onResponderGrant: () => {
      dismissing = true;
    },
    onResponderRelease: () => {
      if (!dismissing) return;
      dismissing = false;
      engine.blurFocused();
    },
    onResponderTerminate: () => {
      dismissing = false;
    },
  });
  return () => {
    stopScroll();
    stopResponder();
  };
}

/**
 * Whether the tap is on an `input-accessory-view` or inside one. On iOS the bar is drawn above the
 * keyboard, outside the scroll view it is written in, so a tap on it is not a tap outside the field,
 * as UIKit has it. React Native's `ScrollView.js` dismisses the keyboard for it all the same. On
 * Android the element is a plain view, inside the scroll view on screen too.
 */
function inAccessoryBar(target: EngineNode): boolean {
  for (let at: EngineNode | null = target; at; at = at.parent) {
    if (viewNameOf(at) === 'InputAccessoryView') return true;
  }
  return false;
}
