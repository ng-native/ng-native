import { Component, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab, type TabIcon } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

/** What the home tab shows, for a test to change. */
export const icon = signal<TabIcon | undefined>({ svg: '<svg id="home"/>' });
export const selectedIcon = signal<TabIcon | undefined>(undefined);

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
      <native-tab path="home" title="Home" [icon]="icon()" [selectedIcon]="selectedIcon()" />
      <native-tab path="search" title="Search" [icon]="{ svg: '<svg id=search/>', size: 30 }" />
    </native-tabs-outlet>
  `,
})
export class Bar {
  protected readonly icon = icon;
  protected readonly selectedIcon = selectedIcon;
}

@Component({ selector: 'x-home', imports: [Text], template: `<text>home</text>` })
export class Home {}

@Component({ selector: 'x-search', imports: [Text], template: `<text>search</text>` })
export class Search {}

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: '',
    component: Bar,
    children: [
      { path: 'home', component: Home },
      { path: 'search', component: Search },
    ],
  },
];
