/**
 * Menus as data, shared by every OS: the menu bar every desktop app gets, how an app's
 * `<menu-bar>` merges into it, and the token a `<menu-item>` registers itself through.
 *
 * `@ng-native/components` builds this from `<menu-group>` and `<menu-item>`, a
 * `<native-header-item [menu]>` reads it, and each OS draws it: the desktop host as the menu bar,
 * iPadOS through UIMenuBuilder. The rules live here, in TypeScript, so every OS follows the same
 * ones; only what AppKit adds itself (Services' contents, Spelling, Substitutions, Dictation and
 * Emoji) is left to the desktop host.
 */
import { InjectionToken, computed, signal, type Signal } from '@angular/core';

/** A standard menu a `<menu-group menuRole>` adds its items to. */
export type MenuGroupRole = 'app' | 'file' | 'edit' | 'view' | 'window' | 'help';

/**
 * What an item is for, where the OS has a standard one: an item with a `menuRole` replaces that
 * role's default item, and without a handler does what the OS does for it.
 */
export type MenuRole =
  | 'about'
  | 'settings'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'showAll'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'find'
  | 'toggleSidebar'
  | 'toggleFullScreen'
  | 'back'
  | 'forward'
  | 'minimize'
  | 'zoom'
  | 'bringAllToFront'
  | 'close'
  | 'print';

/** One item in a menu. */
export interface MenuItemModel {
  readonly label: string;
  readonly menuRole?: MenuRole;
  /** `mod+s`, as `parseShortcut` reads it. */
  readonly shortcut?: string;
  readonly disabled?: boolean;
  /** A check mark, where the item is a toggle. */
  readonly checked?: boolean;
  readonly destructive?: boolean;
  readonly subtitle?: string;
  /** A submenu, or with `inline` a section of the menu the item is in. */
  readonly items?: readonly MenuEntry[];
  readonly inline?: boolean;
  /** What choosing it does. Left out on an item with a `menuRole`, the OS does it. */
  readonly select?: () => void;
}

/** A line between items. */
export interface MenuSeparator {
  readonly separator: true;
}

export type MenuEntry = MenuItemModel | MenuSeparator;

/** One menu in the menu bar. */
export interface MenuGroupModel {
  readonly label: string;
  readonly menuRole?: MenuGroupRole;
  readonly items: readonly MenuEntry[];
}

const SEPARATOR: MenuSeparator = { separator: true };

export const isSeparator = (entry: MenuEntry): entry is MenuSeparator => 'separator' in entry;

/**
 * The menu bar every desktop app gets: App, Edit, View, Window and Help, each item with its role
 * and standard shortcut. `Settings...` is in it until the merge, which keeps it only when the app
 * gives it a handler.
 */
export function defaultMenuBar(appName: string): MenuGroupModel[] {
  const item = (label: string, menuRole: MenuRole, shortcut?: string): MenuItemModel =>
    shortcut ? { label, menuRole, shortcut } : { label, menuRole };
  return [
    {
      label: appName,
      menuRole: 'app',
      items: [
        item(`About ${appName}`, 'about'),
        SEPARATOR,
        item('Settings...', 'settings', 'mod+,'),
        SEPARATOR,
        item('Services', 'services'),
        SEPARATOR,
        item(`Hide ${appName}`, 'hide', 'mod+h'),
        item('Hide Others', 'hideOthers', 'mod+alt+h'),
        item('Show All', 'showAll'),
        SEPARATOR,
        item(`Quit ${appName}`, 'quit', 'mod+q'),
      ],
    },
    {
      label: 'Edit',
      menuRole: 'edit',
      items: [
        item('Undo', 'undo', 'mod+z'),
        item('Redo', 'redo', 'mod+shift+z'),
        SEPARATOR,
        item('Cut', 'cut', 'mod+x'),
        item('Copy', 'copy', 'mod+c'),
        item('Paste', 'paste', 'mod+v'),
        item('Select All', 'selectAll', 'mod+a'),
        SEPARATOR,
        item('Find', 'find', 'mod+f'),
      ],
    },
    {
      label: 'View',
      menuRole: 'view',
      items: [
        item('Back', 'back', 'mod+['),
        item('Forward', 'forward', 'mod+]'),
        SEPARATOR,
        item('Show Sidebar', 'toggleSidebar', 'ctrl+mod+s'),
        item('Enter Full Screen', 'toggleFullScreen', 'ctrl+mod+f'),
      ],
    },
    {
      label: 'Window',
      menuRole: 'window',
      items: [
        item('Minimize', 'minimize', 'mod+m'),
        item('Zoom', 'zoom'),
        SEPARATOR,
        item('Bring All to Front', 'bringAllToFront'),
      ],
    },
    { label: 'Help', menuRole: 'help', items: [] },
  ];
}

/** Every item with a `menuRole`, by role, read through submenus and sections. */
function byRole(groups: readonly MenuGroupModel[]): Map<MenuRole, MenuItemModel> {
  const found = new Map<MenuRole, MenuItemModel>();
  const walk = (entries: readonly MenuEntry[]) => {
    for (const entry of entries) {
      if (isSeparator(entry)) continue;
      if (entry.menuRole && !found.has(entry.menuRole)) found.set(entry.menuRole, entry);
      if (entry.items) walk(entry.items);
    }
  };
  for (const group of groups) walk(group.items);
  return found;
}

/** `entries` without the items `drop` names, and with no separator leading, trailing or doubled. */
function tidy(entries: readonly MenuEntry[], drop: (item: MenuItemModel) => boolean): MenuEntry[] {
  const kept: MenuEntry[] = [];
  for (const entry of entries) {
    if (isSeparator(entry)) {
      if (kept.length && !isSeparator(kept[kept.length - 1]!)) kept.push(entry);
      continue;
    }
    if (drop(entry)) continue;
    kept.push(entry.items ? { ...entry, items: tidy(entry.items, drop) } : entry);
  }
  while (kept.length && isSeparator(kept[kept.length - 1]!)) kept.pop();
  return kept;
}

/**
 * The menu bar an app ends up with, from the defaults and its `<menu-bar>`:
 *
 * - An app item with a `menuRole` replaces the default item with that role, where the default is,
 *   and leaves the group it was written in.
 * - `Settings...` shows only when the app gives a `settings` item a handler.
 * - A group whose `menuRole` names a default menu adds its items to the end of that menu.
 * - A `file` group goes after the App menu, as on a Mac, and any other group after View, in the
 *   order the app wrote them. A group left with no items is left out.
 */
export function mergeMenuBar(
  defaults: readonly MenuGroupModel[],
  app: readonly MenuGroupModel[],
): MenuGroupModel[] {
  const replacing = byRole(app);
  const defaultRoles = byRole(defaults);
  const settings = replacing.get('settings');
  const replace = (entries: readonly MenuEntry[]): MenuEntry[] =>
    entries.map((entry) => {
      if (isSeparator(entry)) return entry;
      const own = entry.menuRole && replacing.get(entry.menuRole);
      if (own) return own;
      return entry.items ? { ...entry, items: replace(entry.items) } : entry;
    });
  const merged: { label: string; menuRole?: MenuGroupRole; items: MenuEntry[] }[] = defaults.map(
    (group) => ({
      ...group,
      items: tidy(
        replace(group.items),
        (item) => item.menuRole === 'settings' && !settings?.select,
      ),
    }),
  );
  const moved = (item: MenuItemModel) => Boolean(item.menuRole && defaultRoles.has(item.menuRole));
  const afterApp: typeof merged = [];
  const afterView: typeof merged = [];
  for (const group of app) {
    const items = tidy(group.items, moved);
    const standard = merged.find((one) => group.menuRole && one.menuRole === group.menuRole);
    if (standard) {
      const joined = standard.items.length && items.length ? [SEPARATOR, ...items] : items;
      standard.items = [...standard.items, ...joined];
    } else if (!items.length) {
      // Every item it had replaced a default: an empty menu is not worth a place in the bar.
      continue;
    } else if (group.menuRole === 'file') afterApp.push({ ...group, items });
    else afterView.push({ ...group, items });
  }
  const at = (role: MenuGroupRole) => merged.findIndex((group) => group.menuRole === role) + 1;
  merged.splice(at('view'), 0, ...afterView);
  merged.splice(at('app'), 0, ...afterApp);
  return merged;
}

/**
 * The entries a menu's `<menu-item>`s registered, in the order they registered. Each item
 * registers a signal of itself, so a changed label or a toggled check reaches the menu, and the
 * function `register` answers takes it out again as the item goes.
 */
export interface MenuModel {
  readonly entries: Signal<readonly MenuEntry[]>;
  register(entry: Signal<MenuEntry>): () => void;
}

/** A menu model for a container to provide as `MENU_MODEL`. */
export function createMenuModel(): MenuModel {
  const registered = signal<readonly Signal<MenuEntry>[]>([]);
  return {
    entries: computed(() => registered().map((entry) => entry())),
    register(entry) {
      registered.update((all) => [...all, entry]);
      return () => registered.update((all) => all.filter((one) => one !== entry));
    },
  };
}

/**
 * Where a `<menu-item>` registers itself: the menu it is written in, which a `<menu-group>`, a
 * submenu or a `<native-header-item [menu]>` template provides. There is none at the root, so an
 * item outside a menu is told so by its own injection.
 */
export const MENU_MODEL = new InjectionToken<MenuModel>('angular-native.menuModel');
