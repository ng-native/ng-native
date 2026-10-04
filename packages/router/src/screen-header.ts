/**
 * Whether the screen a page is on has a bar above its content: a header that is shown and is not
 * translucent, which the page starts below.
 *
 * The header says so and `<screen-safe-area-view>` reads it. On iOS the screen's own safe area
 * already knows, and is zero at the top under such a bar. Android's has no such thing: its view
 * insets by the status bar whatever is above it, which under the bar is a gap of that height.
 */
import { InjectionToken, type WritableSignal } from '@angular/core';

export const SCREEN_HEADER = new InjectionToken<WritableSignal<boolean>>(
  'ng-native.router.screen-header',
);
