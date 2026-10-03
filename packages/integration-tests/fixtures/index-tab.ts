import { Component, DestroyRef, inject, input } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

/** Components ever created, and alive now, by name. */
export const created: Record<string, number> = {};
export const live: Record<string, number> = {};

function track(name: string): void {
  created[name] = (created[name] ?? 0) + 1;
  live[name] = (live[name] ?? 0) + 1;
  inject(DestroyRef).onDestroy(() => (live[name] = live[name]! - 1));
}

@Component({
  selector: 'x-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Shell {}

/** A tab bar at the root whose first tab is at `''`, as Analog's `(tabs)/index.page.ts` makes. */
@Component({
  selector: 'x-bar',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="" title="Home" />
      <native-tab path="schedule" title="Schedule" />
    </native-tabs-outlet>
  `,
})
export class Bar {}

@Component({
  selector: 'x-home-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class HomeStack {
  constructor() {
    track('HomeStack');
  }
}

@Component({ selector: 'x-home', imports: [Text], template: `<text>home</text>` })
export class Home {}

@Component({ selector: 'x-talk', imports: [Text], template: `<text>talk {{ id() }}</text>` })
export class Talk {
  readonly id = input.required<string>();
  constructor() {
    track('Talk');
  }
}

@Component({ selector: 'x-schedule', imports: [Text], template: `<text>schedule</text>` })
export class Schedule {}

/** Outside the bar, pushed over the whole of it. */
@Component({ selector: 'x-user', imports: [Text], template: `<text>user {{ id() }}</text>` })
export class User {
  readonly id = input.required<string>();
}

export const routes: Routes = [
  {
    path: '',
    component: Bar,
    children: [
      {
        path: '',
        component: HomeStack,
        children: [
          { path: '', component: Home },
          { path: '', children: [{ path: 'talks/:id', component: Talk }] },
        ],
      },
      { path: 'schedule', component: Schedule },
    ],
  },
  { path: 'user/:id', component: User },
];
