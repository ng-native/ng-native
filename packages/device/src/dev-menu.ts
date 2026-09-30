/**
 * The developer menu, for the switches an app wants while it is being built.
 *
 * A feature flag, a fake slow network, "log the current state", "clear the database" - the things
 * a team otherwise builds a hidden settings screen for and then has to remember not to ship. These
 * go in the shake menu, which does not exist in a release build, so neither do they.
 *
 * `__DEV__` is checked rather than assumed: `DevSettings` exists in a release bundle and its
 * `addMenuItem` is a no-op there, but an app that registers twenty of them is still doing twenty
 * things at startup for no reason.
 */

import { InjectionToken, Service, inject } from '@angular/core';
import { reactNative } from './react-native.ts';

export interface NativeDevMenu {
  addMenuItem(title: string, handler: () => unknown): void;
  reload(reason?: string): void;
}

/**
 * The menu, and whether there is one to add to.
 *
 * `__DEV__` travels with the module rather than being read from the global inside the class, so a
 * test can say "this is a release build" without writing to `globalThis` and putting it back.
 */
export interface DevMenuSource {
  readonly menu: NativeDevMenu | null;
  readonly development: boolean;
}

/**
 * React Native's menu, reloading through Expo in an Expo app.
 *
 * `DevSettings.reload()` brings an app in Expo Go back without Expo's native modules (`Cannot find
 * native module 'ExpoFontLoader'`) until Expo Go is relaunched. Expo's `reloadAppAsync()` works in
 * Expo Go and a development build alike, and a reload it cannot do falls back to React Native's.
 */
function throughExpo(settings: NativeDevMenu): NativeDevMenu {
  let reloadAppAsync: ((reason?: string) => Promise<void>) | undefined;
  try {
    // Required rather than imported, as `react-native` is: an app without Expo has none.
    // @ts-ignore
    reloadAppAsync = (require('expo') as { reloadAppAsync?: typeof reloadAppAsync }).reloadAppAsync;
  } catch {
    // Not an Expo app: React Native's own reload re-fetches the bundle there.
  }
  const expoReload = reloadAppAsync;
  if (!expoReload) return settings;
  return {
    addMenuItem: (title, handler) => settings.addMenuItem(title, handler),
    reload: (reason) =>
      void expoReload(reason).catch((error: unknown) => {
        console.error(
          "[angular-native] Expo's reload failed; reloading through React Native.",
          error,
        );
        settings.reload(reason);
      }),
  };
}

@Service()
export class DevMenu {
  /** Overridden in a test to register items without a shake menu. */
  static readonly SOURCE = new InjectionToken<DevMenuSource>('angular-native.devMenuSource', {
    factory: () => {
      const settings = reactNative()?.DevSettings;
      return {
        menu: settings ? throughExpo(settings) : null,
        development: (globalThis as { __DEV__?: boolean }).__DEV__ === true,
      };
    },
  });

  private readonly source = inject(DevMenu.SOURCE);

  /** Whether anything registered here will appear. False in a release build. */
  get available(): boolean {
    return this.source.development && this.source.menu !== null;
  }

  /**
   * Add an item to the shake menu.
   *
   * `DevSettings.addMenuItem` already keys on `title` and swaps in the new handler without adding
   * a second native entry - it removes its own previous listener for that title before adding the
   * one just given - so registering the same title again, as a hot reload does when it re-runs the
   * constructor that calls `add()`, is exactly how the fresh handler replaces the stale one rather
   * than being silently dropped.
   */
  add(title: string, handler: () => unknown): void {
    if (!this.available) return;
    this.source.menu!.addMenuItem(title, handler);
  }

  /** Reload the bundle, as the menu's own item does. */
  reload(reason = 'requested by the app'): void {
    this.source.menu?.reload(reason);
  }
}
