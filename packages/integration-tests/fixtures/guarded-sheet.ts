import { Component, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

@Component({
  selector: 'x-guard-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class GuardShell {}

@Component({ selector: 'x-guard-home', imports: [Text], template: `<text>home</text>` })
export class GuardHome {}

/**
 * An editor presented as a sheet, which refuses a swipe down while it holds unsaved changes and
 * hears the attempt, to ask whether to discard them.
 */
@Component({
  selector: 'x-editor-sheet',
  imports: [Text],
  template: `<text>editor</text>`,
  host: {
    '[preventNativeDismiss]': 'dirty()',
    '(nativeDismissCancelled)': 'attempts.set(attempts() + 1)',
  },
})
export class EditorSheet {
  readonly dirty = signal(false);
  readonly attempts = signal(0);
  constructor() {
    editors.push(this);
  }
}

/** Every editor made, newest last, for a test to reach the page on the screen. */
export const editors: EditorSheet[] = [];

/**
 * A presented screen that is a stack of its own, as one with a header is: the editor is the first
 * screen inside it, and the screen a swipe down dismisses is this component's.
 */
@Component({
  selector: 'x-compose-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class ComposeStack {}

/** The same, where the stack's own screen refuses a dismissal whatever the page inside says. */
@Component({
  selector: 'x-locked-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
  host: { '[preventNativeDismiss]': 'true' },
})
export class LockedStack {}

export const guardRoutes: Routes = [
  { path: '', component: GuardHome },
  { path: 'editor', component: EditorSheet },
  {
    path: 'compose',
    component: ComposeStack,
    children: [
      { path: '', component: EditorSheet },
      { path: 'more', component: GuardHome },
    ],
  },
  { path: 'locked', component: LockedStack, children: [{ path: '', component: EditorSheet }] },
];
