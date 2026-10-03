import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NativeHeader, NativeTab, NativeTabsOutlet } from '@ng-native/router';

export const routeMeta: RouteMeta = { title: 'Tabs' };

/**
 * A layout whose outlet is a native tab bar: each page in `tabs/` is a tab, `index.page.ts` the
 * one at `path=""`, the layout's own URL.
 */
@Component({
  imports: [NativeHeader, NativeTab, NativeTabsOutlet],
  template: `
    <native-header [title]="title" />
    <native-tabs-outlet>
      <native-tab path="" title="Counter" sfSymbol="plus.circle.fill" />
      <native-tab path="laps" title="Laps" sfSymbol="stopwatch.fill" />
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
}
