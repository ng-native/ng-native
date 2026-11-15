/** A stack whose page has a required input and two with defaults, for withComponentInputBinding options. */
import { Component, input } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

@Component({
  selector: 'x-options-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Shell {}

@Component({ selector: 'x-options-home', imports: [Text], template: `<text>home</text>` })
export class Home {}

@Component({
  selector: 'x-options-page',
  imports: [Text],
  template: `<text>page {{ id() }} q={{ q() }} label={{ label() }}</text>`,
})
export class Page {
  readonly id = input.required<string>();
  readonly q = input('default-q');
  readonly label = input('default-label');
}

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'page/:id', component: Page },
];
