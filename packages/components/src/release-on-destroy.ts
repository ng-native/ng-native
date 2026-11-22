/**
 * A callback a worklet can hold without holding the component that made it.
 *
 * A function a worklet closes over, such as the target of a `scheduleOnRN`, is sent to the UI
 * thread as a remote function, and react-native-worklets keeps a strong reference to it from
 * native code for as long as the worklet's copy lives. The library caches that copy in a weak map
 * keyed by the worklet, but the remote function is a garbage-collection root, so a callback that
 * reaches the component reaches the gesture, the worklet and the cache entry, and the entry is
 * never released. Detaching the gesture does not help: nothing ng-native or the gesture library
 * holds is left by then, and the cache is private to react-native-worklets. Each screen visit kept
 * its component, its view tree and everything they referenced.
 *
 * What this returns is the function to give the worklet instead. It calls `callback` until
 * `destroyRef` is destroyed, and from then on does nothing, holding only an empty holder.
 */
import { DestroyRef, inject } from '@angular/core';

/**
 * `callback`, reachable only until `destroyRef` (the current component's or service's, by default)
 * is destroyed.
 *
 * ```ts
 * const removed = this.removed;
 * const remove = releaseOnDestroy(() => removed.emit());
 * const pan = Gesture.Pan().onEnd(() => {
 *   'worklet';
 *   scheduleOnRN(remove);
 * });
 * ```
 *
 * Call it in an injection context, or pass a `DestroyRef`.
 */
export function releaseOnDestroy<A extends unknown[]>(
  callback: (...args: A) => void,
  destroyRef: DestroyRef = inject(DestroyRef),
): (...args: A) => void {
  const holder: Holder<A> = { target: callback };
  destroyRef.onDestroy(() => (holder.target = undefined));
  return forwarder(holder);
}

interface Holder<A extends unknown[]> {
  target?: (...args: A) => void;
}

/**
 * Made in a function of its own, and that is load-bearing: Hermes keeps the whole scope of the
 * function a closure was made in, not only the names the closure uses. A forwarder made in
 * `releaseOnDestroy` would keep `callback` and `destroyRef` with it, and so the component.
 */
function forwarder<A extends unknown[]>(holder: Holder<A>): (...args: A) => void {
  return (...args) => holder.target?.(...args);
}
