import { DestroyRef, inject } from '@angular/core';
import type { HostEngine, HostNode } from '@ng-native/fabric';

/** The `nativeID` each element was given here, where the app gave it none. */
const given = new WeakMap<HostNode, string>();
let named = 0;

/**
 * The `nativeID` a host module finds `node`'s view by: the app's own, or one given to it here and
 * kept, so every directive on the element names it alike. A view with a `nativeID` is never
 * flattened away.
 */
function nativeIdOf(engine: HostEngine, node: HostNode): string {
  const own = node.props['nativeID'];
  if (typeof own === 'string' && own) return own;
  let id = given.get(node);
  if (id === undefined) {
    id = `ngn-view-${++named}`;
    given.set(node, id);
  }
  engine.setProp(node, 'nativeID', id);
  return id;
}

/**
 * Something about an element sent to a host module by its view's `nativeID`, where React Native's
 * view would drop it as a prop (Android, iOS). Answers the function that sends it: `send` runs
 * after the element's props are written, so a `nativeID` the app gave is there. Once sent, a
 * `nativeID` the app binds, changes or takes away is followed: `send` runs again with the new one
 * (the given one where the app's went), with `clear` for the old, and `clear` runs as the element
 * goes. Call in an injection context.
 */
export function byNativeId(
  engine: HostEngine,
  node: HostNode,
  send: (nativeID: string) => void,
  clear: (nativeID: string) => void,
): () => void {
  let sentAs: string | null = null;
  let destroyed = false;
  let scheduled = false;
  let flushing = false;
  const flush = () => {
    scheduled = false;
    if (destroyed) return;
    flushing = true;
    try {
      const id = nativeIdOf(engine, node);
      if (sentAs !== null && sentAs !== id) clear(sentAs);
      sentAs = id;
      send(id);
    } finally {
      flushing = false;
    }
  };
  const schedule = () => {
    if (scheduled || destroyed) return;
    scheduled = true;
    engine.settle({ settleProps: flush });
  };
  // The app's own binding, which may arrive, change or go after the first send.
  const unwatch = engine.watchProp(node, 'nativeID', (value) => {
    if (!flushing && sentAs !== null && value !== sentAs) schedule();
  });
  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
    unwatch();
    if (sentAs !== null) clear(sentAs);
  });
  return schedule;
}
