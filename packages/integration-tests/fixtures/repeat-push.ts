import { Component } from '@angular/core';
import type { Routes } from '@angular/router';
import { Pressable } from '../../components/src/pressable.ts';
import { Text } from '../../components/src/text.ts';
import { NativeRouterLink } from '../../router/src/native-router-link.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

let made = 0;

/** A page that says which one of its kind it is, so a test can tell a new one from one kept. */
@Component({ selector: 'x-repeat-a', imports: [Text], template: `<text>A {{ made }}</text>` })
export class RepeatA {
  protected readonly made = ++made;
}

@Component({ selector: 'x-repeat-b', imports: [Text], template: `<text>B</text>` })
export class RepeatB {}

@Component({ selector: 'x-repeat-c', imports: [Text], template: `<text>C</text>` })
export class RepeatC {}

@Component({
  selector: 'x-repeat-shell',
  imports: [NativeStackOutlet],
  template: '<native-stack-outlet />',
})
export class RepeatShell {}

export const repeatRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'a' },
  { path: 'a', component: RepeatA },
  { path: 'b', component: RepeatB },
  { path: 'c', component: RepeatC },
];

@Component({
  selector: 'x-repeat-customer',
  imports: [NativeRouterLink, Pressable, Text],
  template: `<pressable nativeRouterLink="/job"><text>Customer</text></pressable>`,
})
export class RepeatCustomer {}

@Component({
  selector: 'x-repeat-job',
  imports: [NativeRouterLink, Pressable, Text],
  template: `
    <pressable nativeRouterLink="/customer"><text>Job</text></pressable>
    <pressable nativeRouterLink="/note" replace><text>Replace with a note</text></pressable>
    <pressable nativeRouterLink="/customer" [extras]="{ replaceUrl: true }">
      <text>Replace with the customer</text>
    </pressable>
  `,
})
export class RepeatJob {}

export const linkRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'customer' },
  { path: 'customer', component: RepeatCustomer },
  { path: 'job', component: RepeatJob },
  { path: 'note', component: RepeatB },
];
