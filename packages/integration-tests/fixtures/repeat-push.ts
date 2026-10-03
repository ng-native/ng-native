import { Component } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

let made = 0;

/** A page that says which one of its kind it is, so a test can tell a new one from one kept. */
@Component({ selector: 'x-repeat-a', imports: [Text], template: `<text>A {{ made }}</text>` })
export class RepeatA {
  protected readonly made = ++made;
}

@Component({ selector: 'x-repeat-b', imports: [Text], template: `<text>B</text>` })
export class RepeatB {}

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
];
