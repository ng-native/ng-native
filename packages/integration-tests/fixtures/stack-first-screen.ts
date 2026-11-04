import { Component, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { ScrollView } from '../../components/src/scroll-view.ts';
import { Text } from '../../components/src/text.ts';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

@Component({
  selector: 'x-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Shell {}

/** Whether `HiddenShell` hides its stack. */
export const stackHidden = signal(true);

/** A stack the app hides with a binding of its own. */
@Component({
  selector: 'x-hidden-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet [style.display]="hidden() ? 'none' : null" />`,
})
export class HiddenShell {
  protected readonly hidden = stackHidden;
}

/** A stack the app sets `display: flex` on. */
@Component({
  selector: 'x-flex-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet style="display: flex" />`,
})
export class FlexShell {}

/** A root page with a large title over a scroll view, as the canary's home is. */
@Component({
  selector: 'x-home',
  imports: [NativeHeader, ScrollView, Text],
  template: `
    <native-header title="Home" [largeTitle]="true" />
    <scroll-view contentInsetAdjustmentBehavior="automatic"><text>home</text></scroll-view>
  `,
})
export class Home {}

@Component({ selector: 'x-detail', imports: [Text], template: `<text>detail</text>` })
export class Detail {}

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'detail', component: Detail },
];

/** The root page behind `loadComponent`, so the first screen comes turns after the stack. */
export const lazyRoutes: Routes = [
  { path: '', loadComponent: () => Promise.resolve(Home) },
  { path: 'detail', component: Detail },
];
