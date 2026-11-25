import { computed, signal, type OutputEmitterRef, type Signal } from '@angular/core';

/**
 * Whether an output has a listener, as a signal, so an element can follow one added or removed
 * after it first rendered: a template binding, or a subscription from code. For a native prop
 * React Native's components set from whether a handler was passed.
 */
export function outputListened<T>(emitter: OutputEmitterRef<T>): Signal<boolean> {
  const listeners = signal(0);
  const subscribe = emitter.subscribe.bind(emitter);
  emitter.subscribe = (callback) => {
    listeners.update((count) => count + 1);
    const subscription = subscribe(callback);
    let stopped = false;
    return {
      unsubscribe: () => {
        if (stopped) return;
        stopped = true;
        listeners.update((count) => count - 1);
        subscription.unsubscribe();
      },
    };
  };
  return computed(() => listeners() > 0);
}
