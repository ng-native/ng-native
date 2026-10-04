/**
 * A view that keeps its content clear of whatever covers the screen it is in: a translucent
 * navigation bar and the search bar under it, the tab bar, the home indicator and the system bars.
 *
 * ```html
 * <native-header title="Planner" />
 * <screen-safe-area-view [edges]="['top']" style="flex: 1">
 *   <view class="controls">…</view>
 *   <scroll-view>…</scroll-view>
 * </screen-safe-area-view>
 * ```
 *
 * `<safe-area-view>` cannot do this. Its insets come from the nearest `<safe-area-provider>`,
 * which sits at the root of the app, above every bar, and so measures only the window's own
 * unsafe areas: a page under a Liquid Glass header starts behind the bar, and anything pinned to
 * the bottom of a tab ends up under the tab bar.
 *
 * This is react-native-screens' own `RNSSafeAreaView`, which asks the screen it is in instead.
 * On iOS that is the screen's `safeAreaInsets`, which UIKit extends by a translucent navigation
 * bar and by the tab bar, floating or not, on top of the status bar and the home indicator. On
 * Android it is the larger of the bottom navigation bar's height and the system bars. Both follow
 * the bars as they change, rotate, or are hidden.
 *
 * Android's bar is above the page rather than over it, and its view insets the top by the status
 * bar all the same. So under a header that is shown and not translucent the top edge is left
 * alone there, and the page starts under the bar as it does on iOS.
 *
 * **The insets are applied as margin, not padding.** Whatever is beneath the inset shows through
 * it, so a panel whose background has to reach the edge of the screen puts that background on a
 * parent and this inside it: the parent grows by the margin and paints behind the bar, and the
 * content ends where the bar begins.
 *
 * It has to be inside a screen: a page of a stack, or a tab. On iOS, with no screen above it, it
 * insets by nothing.
 */
import { Component, ElementRef, computed, inject, input } from '@angular/core';
import { nativePlatform, type EngineNode } from '@ng-native/fabric';
import { ownHost } from './own-host.ts';
import { SCREEN_HEADER } from './screen-header.ts';

/** The edges of the screen. */
export type ScreenSafeAreaEdge = 'top' | 'right' | 'bottom' | 'left';

const ALL: readonly ScreenSafeAreaEdge[] = ['top', 'right', 'bottom', 'left'];

@Component({
  selector: 'screen-safe-area-view',
  template: '<ng-content />',
  host: { '[edges]': 'resolvedEdges()' },
})
export class ScreenSafeAreaView {
  constructor() {
    ownHost(inject(ElementRef).nativeElement as EngineNode, this.constructor);
  }

  /** Whether the screen has a bar the page starts below. See `screen-header.ts`. */
  private readonly header = inject(SCREEN_HEADER, { optional: true });
  private readonly android = nativePlatform() === 'android';

  /** Which edges to inset. Absent insets all four. */
  readonly edges = input<readonly ScreenSafeAreaEdge[]>();

  /**
   * Native takes all four edges every time, as booleans; a partial record leaves the missing
   * ones at whatever they were.
   */
  protected readonly resolvedEdges = computed(() => {
    const edges = this.edges() ?? ALL;
    // Android insets the top by the status bar whatever is above the page, and a bar is.
    const covered = this.android && this.header?.() ? 'top' : null;
    return Object.fromEntries(
      ALL.map((edge) => [edge, edge !== covered && edges.includes(edge)]),
    ) as Record<ScreenSafeAreaEdge, boolean>;
  });
}
