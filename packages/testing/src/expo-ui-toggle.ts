/**
 * `@expo/ui`'s switch, SwiftUI's `Toggle` or Compose's `Switch`, as a tap flips it.
 *
 * SwiftUI's sends `isOnChange` with the value it now has. Bound to `isOn`, it flips from that;
 * without it, from what it last switched to, which SwiftUI keeps and never commits, so it is kept
 * here by the view's instance handle. Compose's sends `checkedChange` from the `value` committed,
 * which `ui-toggle` commits whether it is bound or not.
 */
import type { FakeFabricNode } from './test-utils.ts';
import { expoUiDisabled } from './expo-ui-button.ts';

/** What each SwiftUI switch left to itself last switched to, by the view's instance handle. */
const switchedOn = new WeakMap<object, boolean>();

/** The event and payload a tap on the node sends, when it is `@expo/ui`'s switch and takes it. */
export function expoUiToggleFlip(node: FakeFabricNode): [string, Record<string, unknown>] | null {
  if (/ExpoUI_SwitchView$/.test(node.viewName)) {
    return ['topCheckedChange', { value: node.props['value'] !== true }];
  }
  if (!/ExpoUI_ToggleView$/.test(node.viewName) || expoUiDisabled(node)) return null;
  const handle = node.instanceHandle;
  const own = typeof handle === 'object' && handle !== null ? handle : null;
  const bound = node.props['isOn'];
  const isOn = !(typeof bound === 'boolean' ? bound : own !== null && switchedOn.get(own) === true);
  if (own) switchedOn.set(own, isOn);
  return ['topIsOnChange', { isOn }];
}
