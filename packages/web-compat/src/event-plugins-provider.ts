import {
  DestroyRef,
  NgZone,
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { EVENT_MANAGER_PLUGINS } from '@angular/platform-browser';
import { Engine } from '@ng-native/fabric';
import { runPlugins, type EventPlugin } from './event-plugins.ts';
import { webListen } from './listen.ts';

/**
 * Angular's event-manager plugins, `EVENT_MANAGER_PLUGINS`, run for the app's listeners, in an
 * app that asked for `provideWebCompat()` too. A listener whose name a plugin claims is attached
 * by that plugin, as Angular's `EventManager` attaches it in a browser: Taiga UI's
 * `@taiga-ui/event-plugins`, which `provideTaiga()` provides, claim names such as
 * `tui-tab-activate.stop`, which its tabs listen by.
 *
 * A plugin that claims every name, as Angular's own DOM plugin does, is left out: the renderer
 * attaches those listeners itself. The plugins stop when the app is destroyed.
 */
export function provideEventPlugins(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    const engine = inject(Engine);
    const plugins = (inject(EVENT_MANAGER_PLUGINS, { optional: true }) ??
      []) as unknown as EventPlugin[];
    const stop = runPlugins(
      engine,
      plugins,
      inject(NgZone),
      (target, eventName, handler, options) =>
        webListen.listen!(target as never, eventName, handler as never, engine, options as never) ??
        (() => {}),
    );
    inject(DestroyRef).onDestroy(stop);
  });
}
