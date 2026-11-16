import { Component } from '@angular/core';
import type { Routes } from '@angular/router';
import { Pressable } from '../../components/src/pressable.ts';
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

@Component({
  selector: 'x-home',
  imports: [Pressable, Text],
  template: `<text>Home</text><pressable testID="home-action" />`,
})
export class Home {}

/** A page pushed onto the stack. */
@Component({
  selector: 'x-detail',
  imports: [Pressable],
  template: `<pressable testID="detail-action" />`,
})
export class Detail {}

/** A page with no selector of its own. */
@Component({ imports: [Pressable], template: `<pressable testID="unnamed-action" />` })
export class Unnamed {}

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
  { path: 'detail', component: Detail },
  { path: 'unnamed', component: Unnamed },
];
