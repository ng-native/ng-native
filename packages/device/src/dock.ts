/**
 * The app's Dock icon on macOS: a menu of the app's own above the standard one, and a bounce that
 * asks for attention. Its badge is the Notifications badge count, from `@ng-native/expo`'s
 * `Notifications.setBadge`, as an app icon's badge is on iOS. Absent on every other OS, where each
 * call does nothing.
 *
 * The host contract, on the `NgNativeDock` module: `setMenu(entries)` takes the menu as
 * `serializeMenu` makes it, or null for none; `bounce(critical)` answers an id that
 * `cancelBounce(id)` takes; `{ type: 'menuSelect', id }` arrives on `ngNativeDock`.
 */
import { InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import type { MenuEntry } from './menu-model.ts';
import { serializeMenu, type NativeMenuEntry } from './menus.ts';
import { reactNative } from './react-native.ts';

export interface NativeDock {
  setMenu(entries: readonly NativeMenuEntry[] | null): void;
  bounce(critical: boolean): number;
  cancelBounce(id: number): void;
  subscribe(listener: (event: { type: 'menuSelect'; id: string }) => void): () => void;
}

interface DockTurboModule {
  setMenu?(entries: readonly NativeMenuEntry[] | null): void;
  bounce?(critical: boolean): number;
  cancelBounce?(id: number): void;
}

function dockSource(): NativeDock | null {
  const native = reactNative();
  const module = native?.TurboModuleRegistry?.get?.('NgNativeDock') as
    DockTurboModule | null | undefined;
  if (!module) return null;
  return {
    setMenu: (entries) => module.setMenu?.(entries),
    bounce: (critical) => module.bounce?.(critical) ?? -1,
    cancelBounce: (id) => module.cancelBounce?.(id),
    subscribe: (listener) => {
      const subscription = native?.DeviceEventEmitter?.addListener('ngNativeDock', (event) =>
        listener(event as { type: 'menuSelect'; id: string }),
      );
      return () => subscription?.remove();
    },
  };
}

@Service()
export class Dock {
  /** Overridden in a test with a fake host. */
  static readonly SOURCE = new InjectionToken<NativeDock | null>('angular-native.dockSource', {
    factory: dockSource,
  });

  private readonly native = inject(Dock.SOURCE);
  private actions: ReadonlyMap<string, () => void> = new Map();
  private readonly unsubscribe =
    this.native?.subscribe((event) => this.actions.get(event.id)?.()) ?? null;

  /** Whether the app has a Dock icon: macOS. */
  readonly available: Signal<boolean> = signal(this.native !== null).asReadonly();

  /**
   * Show `entries` in the Dock icon's menu, above the items macOS adds (Options, Show All Windows,
   * Hide, Quit); an empty list or null takes them away. Items are `MenuItemModel`s, as a
   * `<menu-item>` registers them.
   */
  setMenu(entries: readonly MenuEntry[] | null): void {
    const menu = serializeMenu(entries ?? [], 'macos');
    this.actions = menu.actions;
    this.native?.setMenu(menu.entries.length ? menu.entries : null);
  }

  /**
   * Bounce the Dock icon until the app comes to the front: once, or with `critical` until then.
   * Nothing while the app is in front. Answers the function that stops it.
   */
  bounce(options: { critical?: boolean } = {}): () => void {
    const native = this.native;
    if (!native) return () => {};
    const id = native.bounce(options.critical === true);
    return () => native.cancelBounce(id);
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }
}
