import { Component, afterNextRender, effect, inject, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeNavigation } from '../../router/src/native-navigation.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

@Component({ selector: 'x-gate-home', imports: [Text], template: '<text>Home</text>' })
export class GateHome {}

/** Whether the gated pages may be shown: a plan that includes them, a record that still exists. */
export const allowed = signal(false);

/** A page that leaves as it appears, from an effect, since its condition is a signal. */
@Component({ selector: 'x-gated-effect', imports: [Text], template: '<text>Gated</text>' })
export class GatedByEffect {
  constructor() {
    const nav = inject(NativeNavigation);
    effect(() => {
      if (!allowed()) nav.back();
    });
  }
}

/** The same, a render later, which always worked. */
@Component({ selector: 'x-gated-render', imports: [Text], template: '<text>Gated</text>' })
export class GatedAfterRender {
  constructor() {
    const nav = inject(NativeNavigation);
    afterNextRender(() => nav.back());
  }
}

@Component({
  selector: 'x-gate-shell',
  imports: [NativeStackOutlet],
  template: '<native-stack-outlet />',
})
export class GateShell {}

export const gateRoutes: Routes = [
  { path: '', component: GateHome },
  { path: 'effect', component: GatedByEffect },
  { path: 'render', component: GatedAfterRender },
];
