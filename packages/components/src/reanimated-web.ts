/**
 * `reanimated.ts`, for a browser build.
 *
 * A web bundler resolves `@ng-native/components/reanimated` here, through the `browser` condition
 * in this package's `exports`; Metro, on a device, never sets that condition and gets the native
 * file. A browser has no UI-thread runtime to run a worklet on, so everything here is inert: the
 * names are the same, a template that binds `[workletStyle]` or `[workletScroll]` still renders,
 * and the directives do nothing.
 */
import { Directive, input } from '@angular/core';
import type { MutableValue, WorkletScrollSpec, WorkletStyleSpec } from './worklets.ts';

export {
  workletScroll,
  workletStyle,
  type SharedValue,
  type WorkletScrollSpec,
  type WorkletStyleSpec,
} from './worklets.ts';

/**
 * A shared value as a plain holder, with no second runtime to share it with. Every write reaches
 * the listeners added with `addListener`.
 */
export function sharedValue<T>(initial: T): MutableValue<T> {
  let current = initial;
  const listeners = new Map<number, (value: T) => void>();
  const write = (next: T) => {
    current = next;
    for (const listener of listeners.values()) listener(next);
  };
  return {
    get value() {
      return current;
    },
    set value(next) {
      write(next);
    },
    get: () => current,
    set: (next) => write(typeof next === 'function' ? (next as (value: T) => T)(current) : next),
    modify: (modifier = (value) => value) => write(modifier(current)),
    addListener: (id, listener) => void listeners.set(id, listener),
    removeListener: (id) => void listeners.delete(id),
  };
}

@Directive({ selector: '[workletStyle]' })
export class WorkletStyle {
  readonly workletStyle = input.required<WorkletStyleSpec>();
}

@Directive({ selector: '[workletScroll]' })
export class WorkletScroll {
  readonly workletScroll = input.required<WorkletScrollSpec>();
}
