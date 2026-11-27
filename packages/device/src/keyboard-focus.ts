import { InjectionToken } from '@angular/core';
import { platformOs } from './os.ts';
import { reactNative } from './react-native.ts';

interface KeyboardFocusModule {
  setFocusable?(tag: number, focusable: boolean): void;
}

/**
 * Tells `@ng-native/components`' pod whether the view with react tag `tag` takes the focus of an
 * iPad's hardware keyboard, which React Native's iOS views never do: its iOS props have no
 * `focusable`. The pod's `NgNativeKeyboardFocus` module lets the view be focused, draws the focus
 * halo, and presses it on Space and Return. Nothing off iOS, in Expo Go, or without the pod.
 */
export function reportKeyboardFocusable(tag: number, focusable: boolean): void {
  // Only iOS has the module: asking elsewhere logs that it is missing.
  if (platformOs() !== 'ios') return;
  const module = reactNative()?.TurboModuleRegistry?.get?.('NgNativeKeyboardFocus') as
    KeyboardFocusModule | null | undefined;
  module?.setFocusable?.(tag, focusable);
}

/**
 * Where a view says whether it takes an iPad hardware keyboard's focus: `reportKeyboardFocusable`,
 * which a test replaces to hear what views report.
 */
export const KEYBOARD_FOCUS = new InjectionToken<(tag: number, focusable: boolean) => void>(
  'angular-native.keyboard-focus',
  { providedIn: 'root', factory: () => reportKeyboardFocusable },
);
