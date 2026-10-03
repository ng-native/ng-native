import { Component, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

@Component({ selector: 'x-late-home', imports: [Text], template: `<text>Home page</text>` })
export class LateHome {}

@Component({ selector: 'x-late-detail', imports: [Text], template: `<text>Detail page</text>` })
export class LateDetail {}

/** An app that holds its outlet back until something is ready: a session, a database, fonts. */
@Component({
  selector: 'x-late-shell',
  imports: [NativeStackOutlet, Text],
  template: `
    @if (ready()) {
      <native-stack-outlet />
    } @else {
      <text>Loading</text>
    }
  `,
})
export class LateShell {
  readonly ready = signal(false);
}

export const lateRoutes: Routes = [
  { path: '', component: LateHome },
  { path: 'detail', component: LateDetail },
];

/** The same with a tab bar held back. */
@Component({
  selector: 'x-late-tabs',
  imports: [NativeTab, NativeTabsOutlet, Text],
  template: `
    @if (ready()) {
      <native-tabs-outlet>
        <native-tab path="home" title="Home" />
        <native-tab path="detail" title="Detail" />
      </native-tabs-outlet>
    } @else {
      <text>Loading</text>
    }
  `,
})
export class LateTabs {
  readonly ready = signal(false);
}

export const lateTabRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: LateHome },
  { path: 'detail', component: LateDetail },
];
