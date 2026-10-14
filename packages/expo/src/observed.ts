/**
 * The shape nearly every device-state module has, and the one part of it that is React-only.
 *
 * `getNetworkStateAsync` + `addNetworkStateListener` + `useNetworkState`. `getBatteryLevelAsync` +
 * `addBatteryLevelListener` + `useBatteryLevel`. The two functions are plain; the hook is React
 * state around them, and a hook is the only surface some of these offer for *reading over time*.
 *
 * So this is that hook, as a signal: a value that starts at a stated default, is fetched once,
 * and follows the listener from then on.
 */
import { computed, DestroyRef, inject, signal, type Signal } from '@angular/core';
import { present } from './native.ts';

/** A value the platform knows now and will say more about later. */
export interface Observed<T> {
  current(): Promise<T>;
  subscribe(listener: (value: T) => void): () => void;
}

/**
 * A signal fed by an `Observed`, subscribed until the injector it was made in is destroyed.
 *
 * Called in an injection context, as `inject()` is - a field initialiser or a constructor - so
 * that for a root service the subscription ends with the app. An app cares about the battery for
 * as long as it is running, and not after: one that is mounted and unmounted would otherwise leave
 * a listener behind each time.
 *
 * `initial` is what the value is before the platform has answered, which is always at least one
 * turn: every one of these getters is asynchronous even when the answer is already in memory.
 */
export function observed<T>(source: Observed<T> | null, initial: T): Signal<T> {
  const value = signal(initial);
  if (!source) return value.asReadonly();
  // A module missing from the build says so when the value is read, not as it is subscribed.
  if (!present(source)) return computed(() => source.current as never);

  // Failures are swallowed rather than surfaced: a device with no battery API is a device where
  // the default is the honest answer, and nothing on screen should break over it. The first
  // answer was asked for before anything was heard, so it is older than anything the listener
  // has said by the time it arrives, and is dropped then.
  let heard = false;
  void source.current().then(
    (first) => heard || value.set(first),
    () => {},
  );
  inject(DestroyRef).onDestroy(
    source.subscribe((next) => {
      heard = true;
      value.set(next);
    }),
  );
  return value.asReadonly();
}

/**
 * An `Observed` from the pair of functions these modules always expose.
 *
 * Named for what it makes rather than `from`, which is what it was: the package index re-exports
 * everything, and a bare `from` in an app's import list says nothing about what it is from.
 */
export function observedFrom<T>(
  current: () => Promise<T>,
  subscribe: (listener: (value: T) => void) => { remove(): void },
): Observed<T> {
  return {
    current,
    subscribe: (listener) => {
      const subscription = subscribe(listener);
      return () => subscription.remove();
    },
  };
}
