import { Component, DestroyRef, inject } from '@angular/core';
import type { Routes } from '@angular/router';
import { HardwareBack } from '@ng-native/device';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

/** How many presses the form took, for the test to read. */
export const form = { taken: 0 };

@Component({
  selector: 'x-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Shell {}

/** A form with unsaved changes, which claims the button to ask before it is left. */
@Component({ selector: 'x-form', imports: [Text], template: `<text>form</text>` })
export class Form {
  constructor() {
    const stop = inject(HardwareBack).handle(() => {
      form.taken++;
      return true;
    });
    inject(DestroyRef).onDestroy(stop);
  }
}

@Component({ selector: 'x-picker', imports: [Text], template: `<text>picker</text>` })
export class Picker {}

/** A stack of its own, presented over the form or pushed as a tab. */
@Component({
  selector: 'x-flow',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Flow {}

@Component({ selector: 'x-flow-start', imports: [Text], template: `<text>start</text>` })
export class FlowStart {}

@Component({ selector: 'x-flow-step', imports: [Text], template: `<text>step</text>` })
export class FlowStep {}

@Component({
  selector: 'x-bar',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="one" title="One" />
      <native-tab path="two" title="Two" />
    </native-tabs-outlet>
  `,
})
export class Bar {}

const flow = (): Routes => [
  { path: '', component: FlowStart },
  { path: 'step', component: FlowStep },
];

export const routes: Routes = [
  { path: '', component: Form },
  { path: 'picker', component: Picker },
  { path: 'flow', component: Flow, children: flow() },
  {
    path: 'tabs',
    component: Bar,
    children: [
      { path: 'one', component: Flow, children: flow() },
      { path: 'two', component: Picker },
    ],
  },
];
