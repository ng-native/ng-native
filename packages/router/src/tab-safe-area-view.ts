/**
 * A view that keeps its content clear of the tab bar, as well as the home indicator and the
 * system bars.
 *
 * ```html
 * <view class="panel absolute bottom-0 left-0 right-0">
 *   <tab-safe-area-view [edges]="['bottom']">…</tab-safe-area-view>
 * </view>
 * ```
 *
 * It is `<screen-safe-area-view>` under the name it has inside a tab, where the screen it asks is
 * the tab's and the bar it clears is the tab bar. See `screen-safe-area-view.ts`.
 */
import { Component } from '@angular/core';
import { ScreenSafeAreaView, type ScreenSafeAreaEdge } from './screen-safe-area-view.ts';

/** The edges of the screen. */
export type TabSafeAreaEdge = ScreenSafeAreaEdge;

@Component({
  selector: 'tab-safe-area-view',
  template: '<ng-content />',
})
export class TabSafeAreaView extends ScreenSafeAreaView {}
