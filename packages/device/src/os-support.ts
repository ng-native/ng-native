/**
 * What each desktop API and each macOS-only input does on each OS: the one source the support
 * table on the documentation site is drawn from, and that `os-support.test.ts` holds the code to.
 *
 * A cell is `yes`; `absent`, where `available()` is false and every call is inert; `ignored`, where
 * the input has no effect; `inert`, where an element draws nothing and calls nothing; or a few
 * words on what the OS does instead. It has no imports, so a build script can read it.
 */

/** The OSes the table has a column for, iPadOS and iPhone apart. */
export type SupportOs = 'macos' | 'ipados' | 'iphone' | 'android' | 'web';

export interface OsSupportRow {
  /** The row's name in the table, as Markdown. */
  readonly feature: string;
  /**
   * What the row covers: exported classes and functions, inputs by name, and events as
   * `(dblclick)`. Every one exists.
   */
  readonly covers: readonly string[];
  /**
   * The services whose `available()` follows the row, each with the host module it is made from:
   * true where the row is not `absent` and the module is there, false where it is `absent`.
   */
  readonly services?: Readonly<Record<string, string>>;
  readonly on: Readonly<Record<SupportOs, string>>;
}

export const SUPPORT_OSES: Readonly<Record<SupportOs, string>> = {
  macos: 'macOS',
  ipados: 'iPadOS',
  iphone: 'iPhone',
  android: 'Android',
  web: 'Web host',
};

const row = (
  feature: string,
  covers: readonly string[],
  [macos, ipados, iphone, android, web]: readonly [string, string, string, string, string],
  services?: Readonly<Record<string, string>>,
): OsSupportRow => ({
  feature,
  covers,
  on: { macos, ipados, iphone, android, web },
  ...(services && { services }),
});

const MAC_ONLY = ['yes', 'absent', 'absent', 'absent', 'absent'] as const;

export const OS_SUPPORT: readonly OsSupportRow[] = [
  row(
    '`AppWindows.open`, `provideMainWindow`',
    ['AppWindows', 'CURRENT_WINDOW', 'provideMainWindow', 'provideRestorableWindows'],
    ['yes', 'yes', 'absent', 'absent', 'absent'],
    { AppWindows: 'NgNativeWindows' },
  ),
  row(
    '`titleBar`, window size options',
    ['titleBar', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'resizable', 'fullScreen'],
    ['yes', 'ignored', 'ignored', 'ignored', 'ignored'],
  ),
  row(
    '`<menu-bar>`',
    ['MenuBar', 'MenuGroup', 'MenuItem', 'MenuSeparator', 'Menus'],
    ['menu bar', 'menu bar', 'inert', 'inert', 'inert'],
  ),
  row(
    '`[shortcut]`, menu item shortcuts',
    ['Shortcut'],
    ['yes', 'yes', 'hardware keyboard', 'hardware keyboard', 'yes'],
  ),
  row('`[contextMenu]`', ['ContextMenu'], ['yes', 'inert', 'inert', 'inert', 'inert']),
  row('`<tray-icon>`, `Dock`', ['TrayIcon', 'Tray', 'Dock'], MAC_ONLY, {
    Tray: 'NgNativeTray',
    Dock: 'NgNativeDock',
  }),
  row(
    '`<split-view>`, `<sidebar>`',
    ['SplitView', 'Sidebar', 'SidebarSection', 'SidebarItem', 'SidebarItemPath'],
    ['yes', 'yes', 'stack root', 'list pane at expanded widths', 'two columns'],
  ),
  row('`Processes`, `Processes.env`', ['Processes'], MAC_ONLY, {
    Processes: 'NgNativeProcesses',
  }),
  row('`Shell`', ['Shell'], MAC_ONLY, { Shell: 'NgNativeShell' }),
  row(
    '`FileSystem.paths.home`, `desktop`, `downloads`',
    ['home', 'desktop', 'downloads'],
    MAC_ONLY,
  ),
  row('`UndoStack`', ['UndoStack'], ['yes', 'yes', 'yes', 'absent', 'absent'], {
    UndoStack: 'NgNativeUndo',
  }),
  row(
    '`Updates.checkForAppUpdate()`, `appUpdateAvailable`',
    ['appUpdateAvailable'],
    ['`dmg` builds', 'absent', 'absent', 'absent', 'absent'],
  ),
  row(
    'Drag and drop: `(fileDrop)`, `[dragItem]`',
    ['FileDrop', 'DragItem', '(fileDrop)', '(fileDragEnter)', '(fileDragLeave)', 'dragItem'],
    ['yes', 'yes', 'absent', 'absent', 'absent'],
  ),
  row(
    '`(mouseenter)`, `(mouseleave)`, `(mousemove)`, `(mouseover)`, `(mouseout)`',
    ['(mouseenter)', '(mouseleave)', '(mousemove)', '(mouseover)', '(mouseout)'],
    ['yes', 'trackpad or mouse', 'ignored', 'mouse', 'yes'],
  ),
  row(
    '`(dblclick)`, `(contextmenu)`, `(wheel)`',
    ['(dblclick)', '(contextmenu)', '(wheel)'],
    ['yes', 'ignored', 'ignored', 'ignored', 'ignored'],
  ),
  row(
    '`<native-button>`',
    ['NativeButton'],
    ['AppKit button', 'UIKit button', 'UIKit button', 'drawn', 'HTML button'],
  ),
  row(
    '`controlSize`',
    ['controlSize'],
    ['yes', '`<native-button>`', '`<native-button>`', 'ignored', 'ignored'],
  ),
  row('`anchor` on `<modal>`', ['anchor'], ['popover', 'popover', 'ignored', 'ignored', 'ignored']),
  row(
    '`accessibilityLevel`, `aria-level`',
    ['accessibilityLevel'],
    ['macOS 26 and later', 'ignored', 'ignored', 'ignored', 'yes'],
  ),
];
