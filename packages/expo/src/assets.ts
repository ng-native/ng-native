/**
 * `assets()`, bound to `expo-asset`. Images downloaded before they are needed.
 *
 * ```ts
 * protected readonly hero = assets(() => [require('./hero.png')]);
 *
 * // <image [source]="hero.value()?.[0]" />
 * // @if (hero.isLoading()) { <skeleton /> }
 * ```
 *
 * `useAssets()` is a hook around `Asset.loadAsync`, which is already a plain promise - so what is
 * worth having is not a wrapper but the reason the hook exists: a screen that shows an image
 * bundled with the app still has to wait for it the first time, and a splash screen or a skeleton
 * is only useful if something says when the wait is over.
 *
 * That is `resource()`, exactly. It is per call site for the same reason the hook is: two screens
 * loading different pictures are two separate waits, and a singleton holding one `loaded` signal
 * would have the second screen's load answer the first's. An app that wants assets warmed before
 * there is an injector at all calls `Asset.loadAsync` itself - there is nothing here to add.
 */
import { expoModuleNow } from './native.ts';

import { resource, type Injector, type ResourceRef } from '@angular/core';

/** What `require('./x.png')` becomes, and what a downloaded asset knows about itself. */
export interface AssetLike {
  readonly uri: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface NativeAssets {
  load(modules: readonly (number | string)[]): Promise<readonly AssetLike[]>;
}

/**
 * The modules, downloaded, as a resource.
 *
 * `modules` is reactive: a signal read inside it re-runs the load, which is what a screen showing
 * one of several pictures wants. `value()` is undefined until the first load resolves, and a
 * failure lands in `error()` rather than being thrown at a caller who has nothing to do with it.
 */
export function assetResource(
  native: NativeAssets | null,
  modules: () => readonly (number | string)[],
  options: { injector?: Injector } = {},
): ResourceRef<readonly AssetLike[] | undefined> {
  return resource({
    params: modules,
    loader: ({ params }) => native?.load(params) ?? Promise.resolve([]),
    injector: options.injector,
  });
}

function expoAssets(): NativeAssets | null {
  const expo = expoModuleNow(
    'expo-asset',
    () => require('expo-asset') as typeof import('expo-asset'),
  );
  if (!expo) return null;
  return { load: async (modules) => expo.Asset.loadAsync(modules as number[] | string[]) };
}

/** Download the modules the reactive `modules` function asks for. Created in an injection context. */
export function assets(
  modules: () => readonly (number | string)[],
  options: { injector?: Injector } = {},
): ResourceRef<readonly AssetLike[] | undefined> {
  return assetResource(expoAssets(), modules, options);
}
