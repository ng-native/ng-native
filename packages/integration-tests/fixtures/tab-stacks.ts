import { Component } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

/** The app's own stack, with the tab bar as its first screen, as every tabbed app is built. */
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
      <native-tab path="library" title="Library" />
      <native-tab path="search" title="Search" />
    </native-tabs-outlet>
  `,
})
export class Bar {}

/** A tab that is its own stack. */
@Component({
  selector: 'x-tab-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class TabStack {}

@Component({ selector: 'x-home', imports: [Text], template: `<text>home</text>` })
export class Home {}

@Component({ selector: 'x-library', imports: [Text], template: `<text>library</text>` })
export class Library {}

@Component({ selector: 'x-album', imports: [Text], template: `<text>album</text>` })
export class Album {}

@Component({ selector: 'x-search', imports: [Text], template: `<text>search</text>` })
export class Search {}

@Component({ selector: 'x-result', imports: [Text], template: `<text>result</text>` })
export class Result {}

/** Pushed on the app's stack, over the whole tab bar. */
@Component({ selector: 'x-detail', imports: [Text], template: `<text>detail</text>` })
export class Detail {}

export const routes: Routes = [
  {
    path: '',
    component: Bar,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', component: Home },
      {
        path: 'library',
        component: TabStack,
        children: [
          { path: '', component: Library },
          { path: ':id', component: Album },
        ],
      },
      {
        path: 'search',
        component: TabStack,
        children: [
          { path: '', component: Search },
          // Loaded lazily, as a feature's own routes are: its page is under a route with no component.
          { path: 'saved/:q', loadChildren: () => [{ path: '', component: Result }] },
          { path: ':q', component: Result },
        ],
      },
    ],
  },
  { path: 'detail/:id', component: Detail },
];
