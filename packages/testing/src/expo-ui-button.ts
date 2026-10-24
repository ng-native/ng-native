/**
 * `@expo/ui`'s button, SwiftUI's `Button` or Compose's, as the fake sees it.
 *
 * It commits no accessibility props: the native control is the button a screen reader reads out,
 * by the label it draws, and a tap on it fires `buttonPress` on iOS or `buttonPressed` on Android
 * rather than anything the responder hears. The queries and the press events read it from here.
 */
import { nativePlatform } from '@ng-native/fabric';
import type { FakeFabricNode } from './test-utils.ts';

/** Whether the node is `@expo/ui`'s button, which commits as `Button` in the `ExpoUI` module. */
export const isExpoUiButton = (node: FakeFabricNode): boolean =>
  /ExpoUI_Button$/.test(node.viewName);

/** The text the button draws: what is written inside it, as SwiftUI's or Compose's text. */
function drawnText(node: FakeFabricNode): string {
  if (node.viewName === 'RawText' || /ExpoUI_TextView$/.test(node.viewName)) {
    return String(node.props['text'] ?? '');
  }
  return node.children.map(drawnText).join('');
}

/** What a screen reader reads out for the button: SwiftUI's `label`, or the text inside it. */
export const expoUiButtonName = (node: FakeFabricNode): string =>
  typeof node.props['label'] === 'string' ? node.props['label'] : drawnText(node);

/**
 * Whether SwiftUI's `disabled` modifier has turned the button off. Compose has no such modifier,
 * and its button draws and takes taps the same with it.
 */
export function expoUiButtonDisabled(node: FakeFabricNode): boolean {
  const modifiers = node.props['modifiers'];
  return (
    nativePlatform() !== 'android' &&
    Array.isArray(modifiers) &&
    modifiers.some(
      (modifier: { $type?: unknown; disabled?: unknown }) =>
        modifier.$type === 'disabled' && modifier.disabled === true,
    )
  );
}

/** The event a tap on the button fires, by the platform it was rendered for. */
export const expoUiButtonPress = (): string =>
  nativePlatform() === 'android' ? 'topButtonPressed' : 'topButtonPress';
