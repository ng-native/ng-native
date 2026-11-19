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
 * - On Android it is an Expo module: the constants are properties, it sends the same events through
 *   its own `addListener('ngNativeMenus', ...)`, and it has `setContextMenu(nativeID, entries)`,
 *   since React Native's Android view drops a `contextMenu` prop it does not know.
 * - On iOS it is a TurboModule with `setContextMenu(nativeID, entries)` too, for the same reason.
 *   React Native's iOS view sends no event it does not know either, so the module sends the item
 *   chosen as `{ type: 'contextMenuSelect', nativeID, id }`.
 * - Where it draws context menus, `setTakesLongPress(nativeID, takes)` names a view inside one
 *   whose own `(longPress)` takes a long press first: a long press there opens no menu around it,
 *   as the innermost handler wins in a native app. A right-click still opens the menu on Android.
 *   iOS tells a long press from a secondary click only by the gesture, so an iPad pointer's
 *   secondary click there opens none either.
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
  unmergedGroups,
  type MenuEntry,
  type MenuGroupModel,
} from './menu-model.ts';
import { injectOs } from './os.ts';
import { reactNative } from './react-native.ts';
import {
  isEditingShortcut,
  navigationShortcut,
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

const actionIds = new WeakMap<() => void, string>();
let actionsNamed = 0;

/**
 * The id a menu item with `select` is sent under: the same for as long as the handler is, and no
 * other handler's. `<menu-item>` keeps one handler for its life, so a host that reports a choice
 * from a menu it drew before the items changed still runs that item, or nothing once it has gone,
 * never the item that has taken its place.
 */
export function menuActionId(select: () => void): string {
  let id = actionIds.get(select);
  if (id === undefined) actionIds.set(select, (id = `a${++actionsNamed}`));
  return id;
}

/**
 * `entries` as the host takes them: an id for each item, its shortcut read for `os`, and the
 * handlers by id. An item with a handler is named by it (`menuActionId`); one without, which the
 * app never runs, by its place (`2.0.1`).
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
      const place = `${at}${index}`;
      const { select, shortcut, items, group: _group, ...rest } = entry;
      const id = select ? menuActionId(select) : place;
      if (select) actions.set(id, select);
      return {
        id,
        ...rest,
        // A role item the app handles: the host sends its select rather than doing the role.
        ...(select && entry.menuRole && { handled: true }),
        ...(shortcut
          ? { shortcut: parseShortcut(shortcut, os) }
          : (entry.menuRole === 'back' || entry.menuRole === 'forward') && {
              shortcut: navigationShortcut(entry.menuRole, os),
            }),
        ...(items && { items: walk(items, `${place}.`) }),
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
  | { readonly type: 'shortcut'; readonly id: string; readonly textInputFocused?: boolean }
  /** An item chosen in the context menu of the view with `nativeID` (iOS). */
  | { readonly type: 'contextMenuSelect'; readonly nativeID: string; readonly id: string }
  /**
   * Back or forward, from whichever input the OS has for it: View > Back and Forward and their
   * keys, a two-finger swipe, mouse buttons 4 and 5, the toolbar's chevrons and their history
   * menus. `surface` is the window it was in, and `steps` how many entries (one where absent).
   */
  | {
      readonly type: 'navigate';
      readonly direction: 'back' | 'forward';
      readonly surface?: number;
      readonly steps?: number;
    };

/** A window's history as the host draws it: the titles behind and ahead, nearest first. */
export interface NativeWindowHistory {
  readonly back: readonly string[];
  readonly forward: readonly string[];
}

/** The host's menu module. */
export interface NativeMenus {
  /** Whether the host draws a menu bar: macOS, and iPadOS. */
  readonly menuBar: boolean;
  readonly appName: string;
  setMenuBar(
    groups: readonly { label: string; menuRole?: string; items: NativeMenuEntry[] }[],
  ): void;
  setShortcuts(shortcuts: readonly NativeShortcut[]): void;
  /** The history of the window on `surface`, for its back and forward chevrons. Desktop only. */
  setHistory?(surface: number, history: NativeWindowHistory): void;
  /**
   * The context menu of the view with `nativeID`, or null to take it away. Android and iOS, whose
   * views read no `contextMenu` prop: the host finds the view by its `nativeID`.
   */
  setContextMenu?(nativeID: string, entries: readonly NativeMenuEntry[] | null): void;
  /**
   * Whether the view with `nativeID` takes a long press itself, so a context menu around it does
   * not open on one there. Android and iOS, beside `setContextMenu`.
   */
  setTakesLongPress?(nativeID: string, takes: boolean): void;
  subscribe(listener: (event: NativeMenuEvent) => void): () => void;
}

interface MenusModule {
  getConstants?(): { menuBar?: boolean; appName?: string };
  /** An Expo module's constants, which are its properties. */
  readonly menuBar?: boolean;
  readonly appName?: string;
  setMenuBar?(groups: unknown): void;
  setShortcuts?(shortcuts: unknown): void;
  setHistory?(surface: number, history: unknown): void;
  setContextMenu?(nativeID: string, entries: unknown): void;
  setTakesLongPress?(nativeID: string, takes: boolean): void;
  /** An Expo module's own events. */
  addListener?(event: string, listener: (event: unknown) => void): { remove(): void };
}

/** Android's `NgNativeMenus`, an Expo module, where React Native has no TurboModule of the name. */
function expoMenusModule(): MenusModule | undefined {
  const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  return modules?.['NgNativeMenus'] as MenusModule | undefined;
}

/**
 * The host's menu module: a TurboModule (the desktop host, iOS), or else Android's Expo module.
 * Null where there is neither, as in Expo Go.
 */
export function menusSource(): NativeMenus | null {
  const native = reactNative();
  const turbo = native?.TurboModuleRegistry?.get?.('NgNativeMenus') as
    MenusModule | null | undefined;
  const expo = turbo ? undefined : expoMenusModule();
  const module = turbo ?? expo;
  if (!module) return null;
  const constants = module.getConstants?.() ?? module;
  // An Expo module sends its events itself; a TurboModule's come through DeviceEventEmitter.
  const listen = (hear: (event: unknown) => void) =>
    expo
      ? expo.addListener?.('ngNativeMenus', hear)
      : native?.DeviceEventEmitter?.addListener('ngNativeMenus', hear);
  return {
    menuBar: constants.menuBar === true,
    appName: constants.appName ?? '',
    setMenuBar: (groups) => module.setMenuBar?.(groups),
    setShortcuts: (shortcuts) => module.setShortcuts?.(shortcuts),
    setHistory: (surface, history) => module.setHistory?.(surface, history),
    ...contextMenuMethods(module),
    subscribe: (listener) => {
      const subscription = listen((event) => listener(event as NativeMenuEvent));
      return () => subscription?.remove();
    },
  };
}

/** The context menu methods a module has, bound, and none it lacks: a host without them reads props. */
function contextMenuMethods(
  module: MenusModule,
): Pick<NativeMenus, 'setContextMenu' | 'setTakesLongPress'> {
  const setContextMenu = module.setContextMenu?.bind(module);
  const setTakesLongPress = module.setTakesLongPress?.bind(module);
  return {
    ...(setContextMenu && { setContextMenu }),
    ...(setTakesLongPress && { setTakesLongPress }),
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

  /**
   * Whether the host takes a `[contextMenu]` by the view's `nativeID` through `setContextMenu`
   * (Android and iOS) rather than as the view's `contextMenu` prop. Where it does, it draws the
   * menu on a long press.
   */
  readonly contextMenuByNativeId: boolean = this.native?.setContextMenu !== undefined;

  /**
   * Whether the host, which draws context menus on a long press, can be told which views inside
   * one take a long press themselves (`setTakesLongPress`).
   */
  readonly longPressByNativeId: boolean =
    this.contextMenuByNativeId && this.native?.setTakesLongPress !== undefined;

  /**
   * Say whether the view with `nativeID` takes a long press itself: one there then opens no
   * context menu around it.
   */
  setTakesLongPress(nativeID: string, takes: boolean): void {
    if (takes) this.longPressTakers.add(nativeID);
    else this.longPressTakers.delete(nativeID);
    this.native?.setTakesLongPress?.(nativeID, takes);
  }

  /** The `nativeID`s sent with a context menu, and with a long press of their own. */
  private readonly withContextMenu = new Set<string>();
  private readonly longPressTakers = new Set<string>();

  /**
   * Whether the host opens a context menu on a long press of the view whose `nativeID`s, from it
   * outwards, are `chain`: as it decides, the nearest view with a menu, unless one on the way takes
   * the long press itself. A `(longPress)` around that view leaves the hold to the menu, which the
   * host opens after its own long-press timeout.
   */
  opensContextMenu(chain: Iterable<string | null>): boolean {
    for (const nativeID of chain) {
      if (nativeID === null) continue;
      if (this.withContextMenu.has(nativeID)) return true;
      if (this.longPressTakers.has(nativeID)) return false;
    }
    return false;
  }

  /** What choosing an item does, by the `nativeID` of the view whose menu it is in. */
  private readonly contextMenuChoices = new Map<string, (id: string) => void>();

  /**
   * Send the context menu of the view with `nativeID`, or null to take it away. `choose` runs with
   * the item's `id` where the host sends the choice itself (iOS) rather than through the view.
   */
  setContextMenu(
    nativeID: string,
    entries: readonly NativeMenuEntry[] | null,
    choose?: (id: string) => void,
  ): void {
    if (entries && choose) this.contextMenuChoices.set(nativeID, choose);
    else this.contextMenuChoices.delete(nativeID);
    if (entries?.length) this.withContextMenu.add(nativeID);
    else this.withContextMenu.delete(nativeID);
    this.native?.setContextMenu?.(nativeID, entries);
  }

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
    // Once a label: a `<menu-group label="File">` with no role is a second File menu.
    const warned = new Set<string>();
    effect(() => {
      const defaults = defaultMenuBar(this.native?.appName || 'App');
      for (const label of unmergedGroups(defaults, this.appGroups())) {
        if (warned.has(label)) continue;
        warned.add(label);
        const role = defaults.find(
          (group) => group.label.toLowerCase() === label.toLowerCase(),
        )?.menuRole;
        console.warn(
          `[angular-native] <menu-group label="${label}"> has no menuRole, so it shows as a second ` +
            `${label} menu. Give it menuRole="${role}" to add its items to the ${label} menu.`,
        );
      }
    });
    const native = this.native;
    if (!native) {
      // Read for nothing, so a shortcut the app gets wrong throws where there is no host too, and
      // not first on a device that has one.
      effect(() => this.sentShortcuts());
      return;
    }
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

  private readonly navigators = new Set<
    (direction: 'back' | 'forward', surface?: number, steps?: number) => void
  >();

  /**
   * Hear the OS's back and forward commands. `@ng-native/router` listens, and moves through the
   * history of the window each was in, `steps` entries (one, but for a pick from a chevron's
   * history menu). Answers the function that stops listening.
   */
  onNavigate(
    listener: (direction: 'back' | 'forward', surface?: number, steps?: number) => void,
  ): () => void {
    this.navigators.add(listener);
    return () => void this.navigators.delete(listener);
  }

  /**
   * Tell the host the history of the window on `surface`, which its toolbar's back and forward
   * chevrons and their menus show. `@ng-native/router` calls it. Does nothing where the host has
   * no chevrons.
   */
  setHistory(surface: number, history: NativeWindowHistory): void {
    this.native?.setHistory?.(surface, history);
  }

  private hostSaid(event: NativeMenuEvent): void {
    if (event.type === 'navigate') {
      const steps = event.steps ?? 1;
      this.navigators.forEach((listener) => listener(event.direction, event.surface, steps));
      return;
    }
    if (event.type === 'menuSelect') {
      this.sentBar().actions.get(event.id)?.();
      return;
    }
    if (event.type === 'contextMenuSelect') {
      this.contextMenuChoices.get(event.nativeID)?.(event.id);
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
