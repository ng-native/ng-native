import { Component, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

/**
 * What the test sets: the bar's `[barHidden]`, whether the library tab is in the bar, and whether
 * the bar is there at all, which takes it away while its page stays in front.
 */
export const state = {
  barHidden: signal<boolean | undefined>(undefined),
  showsLibrary: signal(true),
  showsOutlet: signal(true),
};

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
    @if (showsOutlet()) {
      <native-tabs-outlet [barHidden]="barHidden()">
        <native-tab path="home" title="Home" />
        @if (showsLibrary()) {
          <native-tab path="library" title="Library" />
        }
        <native-tab path="more" title="More" />
      </native-tabs-outlet>
    }
  `,
})
export class Bar {
  protected readonly barHidden = state.barHidden;
  protected readonly showsLibrary = state.showsLibrary;
  protected readonly showsOutlet = state.showsOutlet;
}

@Component({
  selector: 'x-tab-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class TabStack {}

@Component({
  selector: 'x-list',
  imports: [Text],
  template: `<text>list</text>`,
})
export class List {}

@Component({
  selector: 'x-reader',
  imports: [NativeHeader, Text],
  template: `<native-header title="Reader" tabBarHidden /><text>reader</text>`,
})
export class Reader {}

@Component({
  selector: 'x-library',
  imports: [Text],
  template: `<text>library</text>`,
})
export class Library {}

/** A second bar, inside a tab of the first. */
@Component({
  selector: 'x-inner-bar',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="one" title="One" />
      <native-tab path="two" title="Two" />
    </native-tabs-outlet>
  `,
})
export class InnerBar {}

@Component({
  selector: 'x-outside',
  imports: [Text],
  template: `<text>outside</text>`,
})
export class Outside {}

export const routes: Routes = [
  { path: 'plain', component: Outside },
  {
    path: 'tabs',
    component: Bar,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      {
        path: 'home',
        component: TabStack,
        children: [
          { path: '', component: List },
          { path: 'reader', component: Reader },
          { path: 'sheet', component: Outside },
        ],
      },
      { path: 'library', component: Library },
      {
        path: 'more',
        component: InnerBar,
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'one' },
          { path: 'one', component: Library },
          { path: 'two', component: Library },
        ],
      },
    ],
  },
  { path: 'outside', component: Outside },
];
