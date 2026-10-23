/**
 * Whether the screen a page is on has a bar above its content: a header that is shown and is not
 * translucent, which the page starts below.
 *
 * The header says so, and `<screen-safe-area-view>` and the stack outlet read it. Before iOS 26
 * the screen's own safe area already knows, and is zero at the top under such a bar. From iOS 26
 * react-native-screens 4.30 runs the screen under the bar, and the outlet insets the page's content
 * by its top edge while this is true. Android's has no such thing: its view insets by the status
 * bar whatever is above it, which under the bar is a gap of that height.
 */
import { InjectionToken, type WritableSignal } from '@angular/core';

export const SCREEN_HEADER = new InjectionToken<WritableSignal<boolean>>(
  'ng-native.router.screen-header',
);
