/**
 * `@expo/ui`: real SwiftUI and Jetpack Compose views, as elements.
 *
 * This is the closest thing in the ecosystem to what this project is for. Every one of these is a
 * platform control - a real `Picker`, a real `BottomSheet`, a real `Gauge` - rather than something
 * drawn to look like one, and `@expo/ui` reaches them through `requireNativeView('ExpoUI', ...)`,
 * which is the same derivation `registerExpoView` already mirrors. So the whole surface is
 * available here for the price of a table of names.
 *
 * The element names are platform-neutral where both platforms have the control, because an app
 * should write `<ui-slider>` once. Where only one platform has it - a `Gauge` is SwiftUI's, a
 * `SearchBar` is Compose's - the element exists only there, and registering for the wrong platform
 * would be an element that commits as nothing.
 *
 * ```ts
 * registerExpoUiViews(Platform.OS);
 * ```
 * ```html
 * <ui-host style="height: 44">
 *   <ui-slider [value]="volume()" (valueChanged)="volume.set($event.value)" />
 * </ui-host>
 * ```
 *
 * **A `<ui-host>` is required around any of these.** SwiftUI and Compose lay out their own
 * subtrees, and the host view is what bridges Yoga's layout to theirs; without one the control has
 * no size and does not appear - which looks exactly like a module that failed to install.
 *
 * Names, not components. There are ninety-odd of these, each with its own props and its own
 * modifier system, and a component per view prop-for-prop would be a second place for every one of
 * them to be wrong. The module's own documentation describes the props; this makes them reachable.
 */
import type { PlatformOSType } from 'react-native';
import { EXPO_UI_VIEWS } from './expo-ui-views.ts';
import { expoUiOnMac } from './expo-ui-macos.ts';
import { registerExpoView } from './register-expo-view.ts';
import { fontModifierNames } from './ui-font-names.ts';

export { EXPO_UI_VIEWS };

/**
 * Register every `@expo/ui` view the platform has.
 *
 * All of them at once, unlike the other registrations here, because they are all one module: an
 * app that has `@expo/ui` installed has all of these, and an app that does not has none of them.
 *
 * Takes `Platform.OS` itself - `'ios' | 'android' | 'macos' | 'windows' | 'web'` - rather than the
 * two platforms `@expo/ui` actually ships for, so a canary app can pass it straight through
 * without narrowing. macOS takes the iOS names of the views the desktop host draws in SwiftUI
 * (`EXPO_UI_MACOS`), and leaves the rest plain views. Anything else registers nothing, the same
 * "not installed" outcome as never calling this at all.
 */
export function registerExpoUiViews(platform: PlatformOSType): void {
  if (platform !== 'ios' && platform !== 'android' && platform !== 'macos') return;
  const index = platform === 'android' ? 1 : 0;
  for (const [element, views] of Object.entries(EXPO_UI_VIEWS)) {
    const viewName = views[index];
    if (!viewName) continue;
    if (platform === 'macos' && !expoUiOnMac(viewName)) continue;
    // SwiftUI's and Compose's `Text` read their text from `text`, and take no child views.
    const textContent = element === 'text' ? 'text' : undefined;
    // `ui-` is a prefix a design system picks too: a component of the app's own keeps its host.
    registerExpoView(`ui-${element}`, 'ExpoUI', {
      viewName,
      textContent,
      yieldsToComponents: true,
      // SwiftUI finds a face by its PostScript name alone; Compose by the name it registered as.
      fontNames: platform !== 'android' ? fontModifierNames : undefined,
    });
  }
}
