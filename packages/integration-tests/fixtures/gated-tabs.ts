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

@Component({
  selector: 'x-bar',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="home" title="Home" />
      <native-tab path="search" title="Search" />
    </native-tabs-outlet>
  `,
})
export class Bar {}

@Component({ selector: 'x-home', imports: [Text], template: `<text>home</text>` })
export class Home {}

@Component({ selector: 'x-search', imports: [Text], template: `<text>search</text>` })
export class Search {}

/** Opens the search tab's guard. Set while the guard is waiting, cleared once it is opened. */
export const gate: { open: (() => void) | null } = { open: null };

/** A guard that waits until the test opens it, like a guard that asks a server. */
function waitForGate(): Promise<boolean> {
  return new Promise((resolve) => {
    gate.open = () => {
      gate.open = null;
      resolve(true);
    };
  });
}

export const gatedRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: '',
    component: Bar,
    children: [
      { path: 'home', component: Home },
      { path: 'search', component: Search, canActivate: [waitForGate] },
    ],
  },
];
