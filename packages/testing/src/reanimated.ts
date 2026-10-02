/**
 * What a test gets for `@ng-native/components/reanimated`.
 *
 * The real entry point reaches Reanimated's and react-native-worklets' source, which Node cannot
 * load, so a test of any component with a `[workletStyle]` or a `[workletScroll]` failed to import
 * before it ran. `ngNative()` resolves the entry point here instead, with the same selectors,
 * inputs and factories, and the one runtime a test has standing in for the UI thread's.
 *
 * A shared value is a signal. A `[workletStyle]` writes what its worklet returns onto its view,
 * again whenever a value it read changes; a `[workletScroll]` runs its worklet for every scroll
 * event the view emits. So a test sees the style an animation settles on, not the frames between:
 * `react-native-reanimated`'s stand-in finishes every animation at once.
 */
import {
  Directive,
  ElementRef,
  Renderer2,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { HostEngine, type HostNode } from '@ng-native/fabric';

/** A value both runtimes can see; here there is one runtime, and it is a signal. */
export interface SharedValue<T = number> {
  value: T;
  get(): T;
  set(value: T | ((current: T) => T)): void;
  modify(modifier?: (value: T) => T, forceUpdate?: boolean): void;
  addListener(id: number, listener: (value: T) => void): void;
  removeListener(id: number): void;
}

export interface WorkletStyleSpec {
  readonly values: readonly unknown[];
  updater(...values: readonly unknown[]): Record<string, unknown>;
}

export interface WorkletScrollSpec {
  readonly values: readonly unknown[];
  handler(event: never, ...values: readonly unknown[]): void;
}

export function sharedValue<T>(initial: T): SharedValue<T> {
  // A write of the same value is skipped, as Reanimated's is, unless it is forced. A forced one
  // reaches every reader, which a signal's own equality check would stop.
  let forced = false;
  const state = signal(initial, { equal: (a, b) => !forced && Object.is(a, b) });
  const listeners = new Map<number, (value: T) => void>();
  const write = (next: T, force = false) => {
    if (!force && Object.is(next, untracked(state))) return;
    forced = force;
    state.set(next);
    forced = false;
    for (const listener of listeners.values()) listener(next);
  };
  return {
    get value() {
      return state();
    },
    set value(next: T) {
      write(next);
    },
    get: () => state(),
    set: (next) => write(typeof next === 'function' ? (next as (current: T) => T)(state()) : next),
    modify: (modifier, forceUpdate = true) =>
      write(modifier ? modifier(untracked(state)) : untracked(state), forceUpdate),
    addListener: (id, listener) => void listeners.set(id, listener),
    removeListener: (id) => void listeners.delete(id),
  };
}

export function workletStyle<const T extends readonly SharedValue<unknown>[]>(
  values: T,
  updater: (...values: T) => Record<string, unknown>,
): WorkletStyleSpec {
  return { values, updater } as WorkletStyleSpec;
}

export function workletScroll<const T extends readonly SharedValue<unknown>[]>(
  values: T,
  handler: (event: never, ...values: T) => void,
): WorkletScrollSpec {
  return { values, handler } as WorkletScrollSpec;
}

@Directive({ selector: '[workletStyle]' })
export class WorkletStyle {
  readonly workletStyle = input.required<WorkletStyleSpec>();

  constructor() {
    const node = inject(ElementRef).nativeElement as HostNode;
    const renderer = inject(Renderer2);
    let written: readonly string[] = [];
    effect(() => {
      const { values, updater } = this.workletStyle();
      const style = updater(...values);
      for (const key of written) if (!(key in style)) renderer.setProperty(node, key, undefined);
      for (const [key, value] of Object.entries(style)) renderer.setProperty(node, key, value);
      written = Object.keys(style);
    });
  }
}

@Directive({ selector: '[workletScroll]' })
export class WorkletScroll {
  readonly workletScroll = input.required<WorkletScrollSpec>();

  constructor() {
    const node = inject(ElementRef).nativeElement as HostNode;
    const engine = inject(HostEngine);
    effect((onCleanup) => {
      const { values, handler } = this.workletScroll();
      onCleanup(
        engine.setEventListener(node, 'topScroll', (event) =>
          handler((event as { nativeEvent: never }).nativeEvent, ...values),
        ),
      );
    });
  }
}
