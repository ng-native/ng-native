import { Component } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

@Component({
  selector: 'x-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Shell {}

/** A tab with a title, and one with a symbol and a spoken label alone. */
@Component({
  selector: 'x-bar',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="home" title="Home" testID="home-tab" />
      <native-tab path="search" sfSymbol="magnifyingglass" accessibilityLabel="Search" />
    </native-tabs-outlet>
  `,
})
export class Bar {}

@Component({ selector: 'x-home', imports: [Text], template: `<text>Home</text>` })
export class Home {}

@Component({ selector: 'x-search', imports: [Text], template: `<text>Search</text>` })
export class Search {}

export const routes: Routes = [
  {
    path: '',
    component: Bar,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', component: Home },
      { path: 'search', component: Search },
    ],
  },
];
