import { Component, effect, type Signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';
import { injectPageFocused } from '../../router/src/page-focused.ts';

/** What the polling page saw, for the test to read. */
export const poll: { focused?: Signal<boolean>; running: number } = { running: 0 };

@Component({
  selector: 'x-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Shell {}

@Component({
  selector: 'x-bar',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="home" title="Home" />
      <native-tab path="plain" title="Plain" />
      <native-tab path="other" title="Other" />
    </native-tabs-outlet>
  `,
})
export class Bar {}

@Component({
  selector: 'x-tab-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class TabStack {}

@Component({ selector: 'x-polling', imports: [Text], template: `<text>polling</text>` })
export class Polling {
  private readonly focused = injectPageFocused();

  constructor() {
    poll.focused = this.focused;
    effect((onCleanup) => {
      if (!this.focused()) return;
      poll.running++;
      onCleanup(() => poll.running--);
    });
  }
}

@Component({ selector: 'x-detail', imports: [Text], template: `<text>detail</text>` })
export class Detail {}

@Component({ selector: 'x-other', imports: [Text], template: `<text>other</text>` })
export class Other {}

export const routes: Routes = [
  {
    path: '',
    component: Bar,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      {
        path: 'home',
        component: TabStack,
        children: [
          { path: '', component: Polling },
          { path: 'detail', component: Detail },
        ],
      },
      { path: 'plain', component: Polling },
      { path: 'other', component: Other },
    ],
  },
  { path: 'cover', component: Detail },
];
