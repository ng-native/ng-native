/**
 * Menus and keyboard shortcuts as the host receives them: the menu bar, the shortcuts that are in
 * no menu, and the form a menu takes on its way to native, which a context menu shares.
 *
 * The host contract, on the `NgNativeMenus` module:
 * - `setMenuBar(groups)`: the whole merged menu bar, each time it changes. The desktop host draws
 *   it as the main menu, iPadOS through UIMenuBuilder. Each item has an `id`; an item with a
 *   `menuRole` and no `id`'s action is the OS's own (Copy, Quit).
 * - `setShortcuts(shortcuts)`: every shortcut the app listens for outside the menu bar, each with
 *   its `id`, its chord read for the OS, and a `label` and `group` for Android's Keyboard Shortcuts
 *   helper. On iPhone and Android the menu bar's own shortcuts are in it too, since no bar is drawn.
 * - It sends `ngNativeMenus` events on `DeviceEventEmitter`: `{ type: 'menuSelect', id }` for a menu
 *   bar item, and `{ type: 'shortcut', id, textInputFocused }` for a chord pressed.
 * - Its constants say whether it draws a menu bar (`menuBar`) and the app's name (`appName`).
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
import {
  defaultMenuBar,
  isSeparator,
  mergeMenuBar,
  type MenuEntry,
  type MenuGroupModel,
} from './menu-model.ts';
import { injectOs } from './os.ts';
import { reactNative } from './react-native.ts';
import {
  isEditingShortcut,
  parseShortcut,
  type ParsedShortcut,
  type ShortcutOs,
} from './shortcut.ts';

/** A menu entry as the host receives it. */
export type NativeMenuEntry =
  | { readonly separator: true }
  | {
      readonly id: string;
      readonly label: string;
      readonly menuRole?: string;
      /** On an item with a `menuRole`: the app handles it, and the OS does not. */
      readonly handled?: true;
      readonly shortcut?: ParsedShortcut;
      readonly disabled?: boolean;
      readonly checked?: boolean;
      readonly destructive?: boolean;
      readonly subtitle?: string;
      readonly sfSymbol?: string;
      readonly icon?: string;
      readonly inline?: boolean;
      readonly items?: readonly NativeMenuEntry[];
    };

/** A menu ready for the host, and what each id it was given does. */
export interface SerializedMenu {
  readonly entries: NativeMenuEntry[];
  readonly actions: ReadonlyMap<string, () => void>;
}

/**
 * `entries` as the host takes them: an id for each item by its place (`2.0.1`), its shortcut read
 * for `os`, and the handlers by id. An id names a place, so a host that reports an id from a menu
 * it drew before the menu changed finds whatever is there now, or nothing.
 */
export function serializeMenu(
  entries: readonly MenuEntry[],
  os: ShortcutOs,
  prefix = '',
): SerializedMenu {
  const actions = new Map<string, () => void>();
  const walk = (list: readonly MenuEntry[], at: string): NativeMenuEntry[] =>
    list.map((entry, index) => {
      if (isSeparator(entry)) return { separator: true };
      const id = `${at}${index}`;
      const { select, shortcut, items, group: _group, ...rest } = entry;
      if (select) actions.set(id, select);
      return {
        id,
        ...rest,
        // A role item the app handles: the host sends its select rather than doing the role.
        ...(select && entry.menuRole && { handled: true }),
        ...(shortcut && { shortcut: parseShortcut(shortcut, os) }),
        ...(items && { items: walk(items, `${id}.`) }),
      };
    });
  return { entries: walk(entries, prefix), actions };
}

/** A shortcut as the host receives it. */
export interface NativeShortcut {
  readonly id: string;
  readonly chord: ParsedShortcut;
  /** What Android's Keyboard Shortcuts helper lists it as. */
  readonly label: string;
  /** The heading it is listed under there: its menu's label, or the app's name. */
  readonly group: string;
}

export type NativeMenuEvent =
  | { readonly type: 'menuSelect'; readonly id: string }
  | { readonly type: 'shortcut'; readonly id: string; readonly textInputFocused?: boolean };

/** The host's menu module. */
export interface NativeMenus {
  /** Whether the host draws a menu bar: macOS, and iPadOS. */
  readonly menuBar: boolean;
  readonly appName: string;
  setMenuBar(
    groups: readonly { label: string; menuRole?: string; items: NativeMenuEntry[] }[],
  ): void;
  setShortcuts(shortcuts: readonly NativeShortcut[]): void;
  subscribe(listener: (event: NativeMenuEvent) => void): () => void;
}

interface MenusTurboModule {
  getConstants?(): { menuBar?: boolean; appName?: string };
  setMenuBar?(groups: unknown): void;
  setShortcuts?(shortcuts: unknown): void;
}

function menusSource(): NativeMenus | null {
  const native = reactNative();
  const module = native?.TurboModuleRegistry?.get?.('NgNativeMenus') as
    MenusTurboModule | null | undefined;
  if (!module) return null;
  const constants = module.getConstants?.() ?? {};
  return {
    menuBar: constants.menuBar === true,
    appName: constants.appName ?? '',
    setMenuBar: (groups) => module.setMenuBar?.(groups),
    setShortcuts: (shortcuts) => module.setShortcuts?.(shortcuts),
    subscribe: (listener) => {
      const subscription = native?.DeviceEventEmitter?.addListener('ngNativeMenus', (event) =>
        listener(event as NativeMenuEvent),
      );
      return () => subscription?.remove();
    },
  };
}

/** The `ShortcutOs` an `OS` reads shortcuts as. */
const shortcutOs = (os: string): ShortcutOs =>
  os === 'android' || os === 'macos' || os === 'web' ? os : 'ios';

/** A `[shortcut]` registered with `KeyboardShortcuts`. */
interface Registered {
  readonly shortcut: Signal<string>;
  readonly label: Signal<string>;
  readonly press: () => void;
}

/**
 * The menus and shortcuts an app has, sent to the host as they change. `<menu-bar>` and
 * `[shortcut]` in `@ng-native/components` register here; an app rarely injects it.
 */
@Service()
export class Menus {
  /** Overridden in a test with a fake host. */
  static readonly SOURCE = new InjectionToken<NativeMenus | null>('angular-native.menusSource', {
    factory: menusSource,
  });

  private readonly native = inject(Menus.SOURCE);
  private readonly os = shortcutOs(injectOs());

  /** Whether the host has the module: shortcuts from a hardware keyboard, and menus. */
  readonly available: Signal<boolean> = signal(this.native !== null).asReadonly();

  /** Whether the menu bar is drawn: macOS and iPadOS. Elsewhere its shortcuts still work. */
  readonly menuBarShown: Signal<boolean> = signal(this.native?.menuBar === true).asReadonly();

  private readonly bars = signal<readonly Signal<readonly MenuEntry[]>[]>([]);
  private readonly shortcuts = signal<readonly Registered[]>([]);

  /** The app's groups, from every `<menu-bar>`, in the order they registered. */
  private readonly appGroups = computed<MenuGroupModel[]>(() =>
    this.bars()
      .flatMap((bar) => bar())
      .flatMap((entry) =>
        isSeparator(entry)
          ? []
          : [
              {
                label: entry.label,
                ...(entry.group && { menuRole: entry.group }),
                items: entry.items ?? [],
              },
            ],
      ),
  );

  /** The menu bar as it is drawn: the OS's defaults with the app's merged in. */
  readonly menuBar: Signal<MenuGroupModel[]> = computed(() =>
    mergeMenuBar(defaultMenuBar(this.native?.appName || 'App'), this.appGroups()),
  );

  private readonly sentBar = computed(() => {
    const groups = this.menuBar();
    const actions = new Map<string, () => void>();
    const sent = groups.map((group, index) => {
      const menu = serializeMenu(group.items, this.os, `${index}.`);
      menu.actions.forEach((action, id) => actions.set(id, action));
      return {
        label: group.label,
        ...(group.menuRole && { menuRole: group.menuRole }),
        items: menu.entries,
      };
    });
    return { sent, actions };
  });

  /**
   * The shortcuts sent to the host: every `[shortcut]`, and where no menu bar is drawn, every
   * menu bar item the app gave a shortcut and a handler, so a hardware keyboard still has them.
   */
  private readonly sentShortcuts = computed(() => {
    const presses = new Map<string, () => void>();
    const editing = new Set<string>();
    const sent: NativeShortcut[] = [];
    const add = (id: string, shortcut: string, label: string, group: string, press: () => void) => {
      presses.set(id, press);
      if (isEditingShortcut(shortcut, this.os)) editing.add(id);
      sent.push({ id, chord: parseShortcut(shortcut, this.os), label, group });
    };
    this.shortcuts().forEach((one, index) =>
      add(`s${index}`, one.shortcut(), one.label(), this.native?.appName || 'App', one.press),
    );
    if (!this.menuBarShown()) {
      const walk = (entries: readonly MenuEntry[], group: string, at: string) =>
        entries.forEach((entry, index) => {
          if (isSeparator(entry)) return;
          if (entry.shortcut && entry.select && !entry.disabled) {
            add(`m${at}${index}`, entry.shortcut, entry.label, group, entry.select);
          }
          if (entry.items) walk(entry.items, group, `${at}${index}.`);
        });
      this.appGroups().forEach((group, index) => walk(group.items, group.label, `${index}.`));
    }
    return { sent, presses, editing };
  });

  private readonly unsubscribe = this.native?.subscribe((event) => this.hostSaid(event)) ?? null;

  constructor() {
    const native = this.native;
    if (!native) return;
    effect(() => {
      if (this.menuBarShown()) native.setMenuBar(this.sentBar().sent);
    });
    effect(() => native.setShortcuts(this.sentShortcuts().sent));
  }

  /**
   * Add a `<menu-bar>`'s groups, each a `MenuItemModel` with `items` and its `group` role. Answers
   * the function that takes them out again, as the `<menu-bar>` goes.
   */
  addMenuBar(groups: Signal<readonly MenuEntry[]>): () => void {
    this.bars.update((all) => [...all, groups]);
    return () => this.bars.update((all) => all.filter((one) => one !== groups));
  }

  /**
   * Listen for `shortcut`, pressed anywhere in the app: `mod+k`, as `parseShortcut` reads it.
   * `label` is what Android's Keyboard Shortcuts helper lists it as. Answers the function that
   * stops listening.
   */
  addShortcut(shortcut: Signal<string>, label: Signal<string>, press: () => void): () => void {
    const registered: Registered = { shortcut, label, press };
    this.shortcuts.update((all) => [...all, registered]);
    return () => this.shortcuts.update((all) => all.filter((one) => one !== registered));
  }

  private hostSaid(event: NativeMenuEvent): void {
    if (event.type === 'menuSelect') {
      this.sentBar().actions.get(event.id)?.();
      return;
    }
    const { presses, editing } = this.sentShortcuts();
    // The editing keys belong to a focused text input: the app's shortcut on one waits.
    if (event.textInputFocused && editing.has(event.id)) return;
    presses.get(event.id)?.();
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }
}
