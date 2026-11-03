/**
 * A stack's navigation bar made ready for a large title before a page with one is pushed.
 *
 * Under a root page with no header, the stack's bar is hidden, and react-native-screens turns on
 * `prefersLargeTitles` only as it shows the bar for the pushed page, once the push has started.
 * A bar never laid out with a large title then animates in from its compact layout on iOS: the
 * inline title fades out and the large title drops into place. `LargeTitleBarModule` in
 * `@ng-native/expo` lays the hidden bar out once with large titles. A header asks for it as its
 * page first renders, before the commit that pushes the page, so the call reaches the main thread
 * ahead of the mount. Without that package, as in Expo Go, the push is as react-native-screens
 * draws it.
 */
import { InjectionToken } from '@angular/core';

/** `LargeTitleBarModule` in `@ng-native/expo`, the iOS half. */
export interface NativeStackBar {
  prepareLargeTitle?(stack: number): Promise<void> | undefined;
}

/** Reached by name, as `nativeTabBar` is. Absent in Expo Go. */
export function nativeStackBar(): NativeStackBar | undefined {
  const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  return modules?.['NgNativeStackBar'] as NativeStackBar | undefined;
}

/** Given by `<native-stack-outlet>` to its pages: readies its bar for a large title. */
export const PREPARE_LARGE_TITLE = new InjectionToken<() => void>(
  'ng-native.router.prepare-large-title',
);
