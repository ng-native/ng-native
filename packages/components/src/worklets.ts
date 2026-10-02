/**
 * Platform capability: Reanimated's worklets, and the UI-thread runtime they run on.
 *
 * Injected rather than imported for the same reason the animation graph is: `react-native-worklets`
 * reaches React Native's Flow source, which Node cannot parse, and the components package has to
 * stay loadable in the test suite. `WorkletStyle` in `../reanimated.ts` carries the real backend
 * as its own provider, so importing the directive is the whole setup, and a test provides a fake
 * runtime instead of needing a device.
 */
import { InjectionToken } from '@angular/core';
import type { ScrollPayload } from './events.ts';

/** A Reanimated shared value. During an animation only the UI runtime reads one. */
export interface SharedValue<T = number> {
  value: T;
}

/**
 * Reanimated's public `SharedValue` surface, which code outside a worklet reads and writes. Written
 * out rather than imported, so that a type naming one resolves where Reanimated is not installed.
 */
export interface MutableValue<T> extends SharedValue<T> {
  get(): T;
  set(value: T | ((value: T) => T)): void;
  modify(modifier?: (value: T) => T, forceUpdate?: boolean): void;
  addListener(id: number, listener: (value: T) => void): void;
  removeListener(id: number): void;
}

/**
 * A style, and the shared values it is computed from.
 *
 * The values are arguments to the worklet rather than things it captures, and that is the whole
 * reason this is a function of its inputs. A worklet captures its free variables by value when it
 * is created, so one written inside a component that reads `this.x` would capture the component -
 * every signal, the injector, the view - and try to serialise all of it onto the other runtime.
 * Taking the values as arguments makes that impossible to write by accident, and makes the
 * dependency list the thing the UI runtime is subscribed to rather than a guess.
 */
export interface WorkletStyleSpec {
  readonly values: readonly unknown[];
  /**
   * Called with `values`. Declared as a method rather than a property so that a spec built from
   * a known tuple of shared values is still a `WorkletStyleSpec`: the parameter types are checked
   * in the factory below, against the values it was handed, and widen on the way in.
   */
  updater(...values: readonly unknown[]): Record<string, unknown>;
}

/**
 * Bind a style to the shared values it reads.
 *
 * ```ts
 * protected readonly slide = workletStyle([this.offset], (offset) => {
 *   'worklet';
 *   return { transform: [{ translateX: offset.value }] };
 * });
 * ```
 */
export function workletStyle<const T extends readonly SharedValue<unknown>[]>(
  values: T,
  updater: (...values: T) => Record<string, unknown>,
): WorkletStyleSpec {
  return { values, updater };
}

/** A worklet run on every scroll frame, and the shared values it is given. */
export interface WorkletScrollSpec {
  readonly values: readonly unknown[];
  /**
   * Called on the UI runtime with the event and `values`. See `WorkletStyleSpec.updater`.
   *
   * The payload rather than the wrapped event a listener gets: Reanimated hands a worklet what
   * native put in the event, with no `nativeEvent` around it.
   */
  handler(event: ScrollPayload, ...values: readonly unknown[]): void;
}

/**
 * Bind a worklet to a scroll view's scrolling.
 *
 * ```ts
 * protected readonly parallax = workletScroll([this.offset], (event, offset) => {
 *   'worklet';
 *   offset.value = event.contentOffset.y;
 * });
 * ```
 *
 * The point of it is where it runs: native delivers the scroll to the UI runtime, the worklet
 * writes a shared value there, and a `[workletStyle]` reads it there - so a header that shrinks
 * with the scroll never involves the JavaScript thread at all, and cannot fall behind it.
 */
export function workletScroll<const T extends readonly SharedValue<unknown>[]>(
  values: T,
  handler: (event: ScrollPayload, ...values: T) => void,
): WorkletScrollSpec {
  return { values, handler };
}

/** What the UI runtime writes to: a node's react tag and the shadow node behind it. */
export interface WorkletTarget {
  readonly tag: number;
  readonly shadowNode: unknown;
}

export interface WorkletBackend {
  /**
   * Run `style.updater` on the UI runtime whenever one of its values changes, writing what it
   * returns onto `target`. Returns the function that stops it.
   */
  bind(target: WorkletTarget, style: WorkletStyleSpec): () => void;

  /**
   * Run `spec.handler` on the UI runtime for every scroll event `target` emits. Returns the
   * function that stops it.
   */
  scroll(target: WorkletTarget, spec: WorkletScrollSpec): () => void;
}

export const WORKLETS = new InjectionToken<WorkletBackend>('angular-native.worklets');
