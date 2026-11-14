/**
 * Icons in the macOS menu bar's status area, each with a menu or a press of its own. `<tray-icon>`
 * in `@ng-native/components` registers here. Absent on iOS and Android, where nothing is drawn.
 *
 * The host contract, on the `NgNativeTray` module: `setIcons(icons)` takes every icon each time one
 * changes, as `{ id, title, sfSymbol, image, tooltip, menu }`, `menu` as `serializeMenu` makes it
 * (null for an icon with a press instead). It sends `{ type: 'press', icon }` and
 * `{ type: 'menuSelect', icon, id }` on `ngNativeTray`.
 */
import {
  InjectionToken,
  Service,
  computed,
  effect,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import type { MenuEntry } from './menu-model.ts';
import { serializeMenu, type NativeMenuEntry } from './menus.ts';
import { reactNative } from './react-native.ts';

/** One icon as an app describes it. */
export interface TrayIconModel {
  readonly title?: string;
  /** An SF Symbol, drawn as a template image that follows the menu bar's appearance. */
  readonly sfSymbol?: string;
  /** An image asset's name, for an icon of the app's own. */
  readonly image?: string;
  readonly tooltip?: string;
  /** The menu a click opens; with none, a click is a press. */
  readonly menu: readonly MenuEntry[];
  readonly press: () => void;
}

export interface NativeTrayIcon {
  readonly id: string;
  readonly title?: string;
  readonly sfSymbol?: string;
  readonly image?: string;
  readonly tooltip?: string;
  readonly menu: readonly NativeMenuEntry[] | null;
}

export type NativeTrayEvent =
  | { readonly type: 'press'; readonly icon: string }
  | { readonly type: 'menuSelect'; readonly icon: string; readonly id: string };

export interface NativeTray {
  setIcons(icons: readonly NativeTrayIcon[]): void;
  subscribe(listener: (event: NativeTrayEvent) => void): () => void;
}

interface TrayTurboModule {
  setIcons?(icons: readonly NativeTrayIcon[]): void;
}

function traySource(): NativeTray | null {
  const native = reactNative();
  const module = native?.TurboModuleRegistry?.get?.('NgNativeTray') as
    TrayTurboModule | null | undefined;
  if (!module) return null;
  return {
    setIcons: (icons) => module.setIcons?.(icons),
    subscribe: (listener) => {
      const subscription = native?.DeviceEventEmitter?.addListener('ngNativeTray', (event) =>
        listener(event as NativeTrayEvent),
      );
      return () => subscription?.remove();
    },
  };
}

@Service()
export class Tray {
  /** Overridden in a test with a fake host. */
  static readonly SOURCE = new InjectionToken<NativeTray | null>('angular-native.traySource', {
    factory: traySource,
  });

  private readonly native = inject(Tray.SOURCE);
  private readonly icons = signal<readonly { id: string; model: Signal<TrayIconModel> }[]>([]);
  private next = 0;

  /** Whether the OS has a status area for the app: macOS. */
  readonly available: Signal<boolean> = signal(this.native !== null).asReadonly();

  private readonly sent = computed(() =>
    this.icons().map(({ id, model }) => {
      const { menu, press, ...icon } = model();
      const serialized = serializeMenu(menu, 'macos');
      return {
        icon: { id, ...icon, menu: serialized.entries.length ? serialized.entries : null },
        actions: serialized.actions,
        press,
      };
    }),
  );

  private readonly unsubscribe = this.native?.subscribe((event) => this.hostSaid(event)) ?? null;

  constructor() {
    const native = this.native;
    if (native) effect(() => native.setIcons(this.sent().map((one) => one.icon)));
  }

  /** Show an icon for as long as the function answered is not called. */
  add(model: Signal<TrayIconModel>): () => void {
    const one = { id: `tray-${this.next++}`, model };
    this.icons.update((all) => [...all, one]);
    return () => this.icons.update((all) => all.filter((each) => each !== one));
  }

  private hostSaid(event: NativeTrayEvent): void {
    const icon = this.sent().find((one) => one.icon.id === event.icon);
    if (event.type === 'press') icon?.press();
    else icon?.actions.get(event.id)?.();
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }
}
