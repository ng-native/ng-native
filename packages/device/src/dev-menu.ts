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
 * React Native's menu, reloading the way Metro's Fast Refresh runtime does.
 *
 * `DevSettings.reload()` brings an app in Expo Go back without Expo's native modules (`Cannot find
 * native module 'ExpoFontLoader'`) until Expo Go is relaunched. In development `@ng-native/platform`
 * routes the refresh runtime's full reload through Expo's `reloadAppAsync()` in an Expo app, falling
 * back to React Native's, so this reloads through it. Neither this package nor the bundle it is in
 * names `expo` for that: an app on the web, or without Expo, has none to resolve. Without the runtime,
 * as in a release build, it is React Native's reload.
 */
function throughRefreshRuntime(settings: NativeDevMenu): NativeDevMenu {
  return {
    addMenuItem: (title, handler) => settings.addMenuItem(title, handler),
    reload: (reason) => {
      const scope = globalThis as { __METRO_GLOBAL_PREFIX__?: string } & Record<string, unknown>;
      const refresh = scope[`${scope.__METRO_GLOBAL_PREFIX__ ?? ''}__ReactRefresh`] as
        { performFullRefresh?: (reason: string) => void } | undefined;
      if (refresh?.performFullRefresh) refresh.performFullRefresh(reason ?? 'requested by the app');
      else settings.reload(reason);
    },
  };
}

@Service()
export class DevMenu {
  /** Overridden in a test to register items without a shake menu. */
  static readonly SOURCE = new InjectionToken<DevMenuSource>('angular-native.devMenuSource', {
    factory: () => {
      const settings = reactNative()?.DevSettings;
      return {
        menu: settings ? throughRefreshRuntime(settings) : null,
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
