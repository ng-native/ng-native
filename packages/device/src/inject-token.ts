import { DestroyRef, inject, signal, type Signal } from '@angular/core';
import { HostEngine, type HostNode } from '@ng-native/fabric';

export interface InjectTokenOptions {
  /** The node whose scope it is read in, for a token a class lower in the tree sets again. */
  at?: HostNode;
}

/**
 * A custom property's value as text, `rgb(255, 0, 0)` or `12px`, as a signal: what a prop, a
 * drawing or an API that takes a colour rather than a style is given, kept in step with the
 * stylesheet as the host follows it (see `HostEngine.watchToken`). Undefined where nothing defines
 * the token, or where it holds a value with no text form, such as a shadow. At the root by
 * default, and known there from the start; at a node, once the host has styled it. Stops following
 * it when the injection context is destroyed.
 */
export function injectToken(
  name: string,
  options?: InjectTokenOptions,
): Signal<string | undefined> {
  const engine = inject(HostEngine);
  const value = signal(engine.token(name, options?.at));
  const stop = engine.watchToken(name, (next) => value.set(next), options?.at);
  inject(DestroyRef).onDestroy(stop);
  return value.asReadonly();
}
