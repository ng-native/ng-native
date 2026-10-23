import { Component, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

/** What the test sets: the bar's own `[barHidden]`, and the detail header's `tabBarHidden`. */
export const state = {
  barHidden: signal<boolean | undefined>(undefined),
  detailHides: signal(true),
  detailHasHeader: signal(true),
  libraryHides: signal(false),
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
    <native-tabs-outlet [barHidden]="barHidden()">
      <native-tab path="home" title="Home" />
      <native-tab path="library" title="Library" />
    </native-tabs-outlet>
  `,
})
export class Bar {
  protected readonly barHidden = state.barHidden;
}

@Component({
  selector: 'x-tab-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class TabStack {}

@Component({
  selector: 'x-list',
  imports: [NativeHeader, Text],
  template: `<native-header title="List" /><text>list</text>`,
})
export class List {}

@Component({
  selector: 'x-detail',
  imports: [NativeHeader, Text],
  template: `
    @if (hasHeader()) {
      <native-header title="Detail" [tabBarHidden]="hides()" />
    }
    <text>detail</text>
  `,
})
export class Detail {
  protected readonly hides = state.detailHides;
  protected readonly hasHeader = state.detailHasHeader;
}

/** A page pushed over the detail, which keeps the bar. */
@Component({
  selector: 'x-more',
  imports: [NativeHeader, Text],
  template: `<native-header title="More" /><text>more</text>`,
})
export class More {}

/** A tab whose page has no stack. */
@Component({
  selector: 'x-library',
  imports: [NativeHeader, Text],
  template: `<native-header title="Library" [tabBarHidden]="hides()" /><text>library</text>`,
})
export class Library {
  protected readonly hides = state.libraryHides;
}

/** A page on the app's own stack, outside any tab. */
@Component({
  selector: 'x-outside',
  imports: [NativeHeader, Text],
  template: `<native-header title="Outside" tabBarHidden /><text>outside</text>`,
})
export class Outside {}

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
          { path: '', component: List },
          { path: ':id', component: Detail },
          { path: ':id/more', component: More },
        ],
      },
      { path: 'library', component: Library },
    ],
  },
  { path: 'outside', component: Outside },
];
