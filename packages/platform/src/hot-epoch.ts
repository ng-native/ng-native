/**
 * What makes a hot patch show: a signal every patched function and method reads, and every patch
 * changes.
 *
 * A patch puts new code behind a function or a method and changes nothing a template or a
 * `computed` reads, so neither would ask again: the edit landed and the screen went on showing
 * the answer from before it. The hot update in `@ng-native/metro` calls `read` from each function
 * and method it can patch, and `bump` after patching. Whatever was working a value out when it
 * called one, depends on the patch count from then on and works it out again.
 *
 * Only what is safe to run again reads it: a template, a `computed`, a `linkedSignal`. An `effect`
 * that called a patched method has done something, and a save is no reason to do it twice.
 */
import { signal } from '@angular/core';
import { getActiveConsumer } from '@angular/core/primitives/signals';

/** The reactive consumers that work a value out, and can be asked to again. */
const DERIVES = new Set(['computed', 'template', 'linkedSignal']);

interface HotEpoch {
  read(): void;
  bump(): void;
}

declare const __DEV__: boolean | undefined;

/** Development only: a release build has nothing to patch, and folds the rest of this away. */
export function installHotEpoch(): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const scope = globalThis as { __angularNativeHot?: HotEpoch };
  if (scope.__angularNativeHot) return;
  const patches = signal(0);
  scope.__angularNativeHot = {
    read() {
      if (DERIVES.has(getActiveConsumer()?.kind ?? '')) patches();
    },
    bump() {
      patches.update((count) => count + 1);
    },
  };
}
