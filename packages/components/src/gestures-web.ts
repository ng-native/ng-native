/**
 * `gestures.ts`, for a browser build.
 *
 * A web bundler resolves `@ng-native/components/gestures` here, through the `browser` condition in
 * this package's `exports`; Metro, on a device, never sets that condition and gets the native file.
 * A browser has no native gesture recognisers, so everything here is inert: the names are the
 * same, a template that uses `<gesture-root>` and `[gesture]` still renders, and `[gesture]`
 * attaches nothing.
 */
import { Component, Directive, input } from '@angular/core';
import type { GestureSpec } from './gesture-backend.ts';

export { type GestureSpec, type GestureTarget } from './gesture-backend.ts';

@Directive({ selector: '[gesture]' })
export class NativeGesture {
  readonly gesture = input.required<GestureSpec>();
}

/** A box that fills its parent, as the native root does. `@ng-native/web`'s reset gives it `flex: 1`. */
@Component({ selector: 'gesture-root', template: '<ng-content />' })
export class GestureRoot {}
