/**
 * Tabs written the less usual ways, and a header on its own: what the plain tabs fixture does not
 * reach. Read by `router-tabs.test.ts`.
 */
import { Component } from '@angular/core';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

@Component({
  selector: 'x-tab-variants',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="untitled" [icon]="{ xcasset: 'Inbox' }" />
      <native-tab path="both" title="Both" sfSymbol="star" [icon]="{ sfSymbol: 'heart' }" />
      <native-tab
        path="image"
        title="Image"
        [icon]="{ image: 7 }"
        [standardAppearance]="appearance"
      />
      <native-tab path="shared" title="Shared" sfSymbol="person.2" drawable="ic_people" />
    </native-tabs-outlet>
  `,
})
export class TabVariants {
  protected readonly appearance = { stacked: { normal: { tabBarItemIconColor: 'grey' } } };
}

@Component({
  selector: 'x-header-alone',
  imports: [NativeHeader],
  template: `<native-header title="Alone" />`,
})
export class HeaderAlone {}
