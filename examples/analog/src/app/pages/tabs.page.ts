import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { nativePlatform } from '@ng-native/fabric';
import { NativeHeader, NativeTab, NativeTabsOutlet, type TabIcon } from '@ng-native/router';

export const routeMeta: RouteMeta = { title: 'Tabs' };

/**
 * SF Symbols on iOS. Android has no symbol set, so it gets an image, drawn as a mask so the bar
 * tints it like a symbol.
 */
const icon = (symbol: string, image: unknown): TabIcon =>
  nativePlatform() === 'android' ? { template: image } : { sfSymbol: symbol };

/**
 * A layout whose outlet is a native tab bar: each page in `tabs/` is a tab, `index.page.ts` the
 * one at `path=""`, the layout's own URL.
 */
@Component({
  imports: [NativeHeader, NativeTab, NativeTabsOutlet],
  template: `
    <native-header [title]="title" />
    <native-tabs-outlet>
      <native-tab path="" title="Counter" [icon]="counterIcon" />
      <native-tab path="laps" title="Laps" [icon]="lapsIcon" />
    </native-tabs-outlet>
  `,
  styles: `
    :host {
      flex: 1;
    }
  `,
})
export default class TabsLayout {
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly counterIcon = icon(
    'plus.circle.fill',
    require('../../../assets/tab-counter.png'),
  );
  protected readonly lapsIcon = icon('stopwatch.fill', require('../../../assets/tab-laps.png'));
}
