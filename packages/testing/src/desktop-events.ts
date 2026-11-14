/**
 * The user events a desktop adds, as @testing-library/user-event names them: a mouse that hovers,
 * double-clicks, right-clicks and scrolls, and a keyboard that presses shortcuts and walks focus
 * with Tab. They work under any `os`, emitting what the desktop host sends; on a phone OS a view
 * that never asked for mouse events hears nothing, as on a device.
 */
import {
  AppWindows,
  DeepLinks,
  Menus,
  OS,
  parseShortcut,
  type KeyChord,
  type NativeMenuEntry,
  type ShortcutOs,
} from '@ng-native/device';
import { currentOf, lastRender, ownerOf, settle, type TestWindow } from './render.ts';
import { flatten, isTextInput, withParents } from './queries.ts';
import type { FakeDeepLinks, FakeMenus } from './desktop-fakes.ts';
import type { FakeFabricNode } from './test-utils.ts';

type Rendered = ReturnType<typeof lastRender>;

/** What a pointer event from a mouse carries: the pointer type that tells it from a finger. */
const MOUSE = { pointerType: 'mouse', pageX: 0, pageY: 0, locationX: 0, locationY: 0 };

function emit(node: FakeFabricNode, type: string, nativeEvent: Record<string, unknown> = {}): void {
  ownerOf(node).fabric.emit(node, type, { target: node.reactTag, ...nativeEvent });
}

/** The views the pointer is over in each render, outermost first. */
const hovered = new WeakMap<Rendered, FakeFabricNode[]>();
/** The view each render's keyboard focus is on. */
const focused = new WeakMap<Rendered, FakeFabricNode | null>();

/** `node` and the views it is inside, outermost first, in the current commit. */
function chain(node: FakeFabricNode): FakeFabricNode[] {
  withParents(ownerOf(node).roots());
  const nodes: FakeFabricNode[] = [];
  for (let at: FakeFabricNode | null = currentOf(node) ?? node; at; at = at.parent ?? null) {
    nodes.unshift(at);
  }
  return nodes;
}

/** Move the pointer onto `node`: a leave for each view it left, an enter for each it came into. */
async function moveTo(node: FakeFabricNode | null, owner: Rendered): Promise<void> {
  const before = hovered.get(owner) ?? [];
  const after = node ? chain(node) : [];
  const same = (a: FakeFabricNode, b: FakeFabricNode) => a.reactTag === b.reactTag;
  const left = before.filter((old) => !after.some((now) => same(now, old))).reverse();
  const entered = after.filter((now) => !before.some((old) => same(now, old)));
  for (const view of left) emit(view, 'topPointerLeave', MOUSE);
  for (const view of entered) emit(view, 'topPointerEnter', MOUSE);
  if (node) emit(node, 'topPointerMove', MOUSE);
  hovered.set(owner, after);
  await settle();
}

/** A chord as `keyboard` takes it, `mod+k`, read for the OS the render is on. */
function chordOf(shortcut: string, os: ShortcutOs): KeyChord {
  const parsed = parseShortcut(shortcut, os);
  return {
    key: parsed.key,
    meta: parsed.meta,
    ctrl: parsed.ctrl,
    alt: parsed.alt,
    shift: parsed.shift,
  };
}

/** Whether a view takes keyboard focus: a text input, or a view that says it is focusable. */
const focusable = (node: FakeFabricNode): boolean =>
  isTextInput(node) || node.props['focusable'] === true;

/** A context menu a right-click opened, as the host draws it from the view's `contextMenu`. */
export interface FakeContextMenu {
  /** Its entries, as the view committed them. */
  readonly items: readonly Exclude<NativeMenuEntry, { separator: true }>[];
  /** Choose the item with `label` (at any depth), as a click on it does. */
  choose(label: string | RegExp): Promise<void>;
}

/** The context menu of `node` or the nearest view it is inside that has one, or null. */
function contextMenuOf(node: FakeFabricNode): FakeContextMenu | null {
  const owner = chain(node)
    .reverse()
    .find((view) => Array.isArray(view.props['contextMenu']));
  if (!owner) return null;
  const entries = owner.props['contextMenu'] as readonly NativeMenuEntry[];
  const items = entries.filter(
    (entry): entry is Exclude<NativeMenuEntry, { separator: true }> => !('separator' in entry),
  );
  const find = (list: readonly NativeMenuEntry[], label: string | RegExp): string | null => {
    for (const entry of list) {
      if ('separator' in entry) continue;
      const hit = typeof label === 'string' ? entry.label === label : label.test(entry.label);
      if (hit && !entry.disabled) return entry.id;
      const inner = find(entry.items ?? [], label);
      if (inner) return inner;
    }
    return null;
  };
  return {
    items,
    async choose(label) {
      const id = find(entries, label);
      if (id === null) throw new Error(`No enabled item ${String(label)} in the context menu.`);
      emit(owner, 'topContextMenuSelect', { id });
      await settle();
    },
  };
}

/** The host's windows in the most recent render, or an error that says how to have them. */
function hostWindows() {
  const owner = lastRender();
  if (!owner.windows) {
    throw new Error(
      'The render has no windows to close, quit or reopen: render with os: "macos", or provide ' +
        'provideDesktopFakes({ windows: fakeWindows() }).',
    );
  }
  return { owner, windows: owner.windows };
}

/** Wait for the app to answer: its guards and `willQuit` handlers may take a few turns. */
async function answered(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 20 && !done(); turn++) await settle();
}

export interface DesktopUserEvent {
  /** Move a mouse onto `node`, entering it and each view it is inside. */
  hover(node: FakeFabricNode): Promise<void>;
  /** Move the mouse off `node`, and off each view it is inside. */
  unhover(node: FakeFabricNode): Promise<void>;
  /** Two clicks in quick succession: `(dblclick)`. */
  dblClick(node: FakeFabricNode): Promise<void>;
  /**
   * A secondary click: `(contextmenu)`, and the context menu of the view or the nearest one it is
   * inside, as the host opens it. Null where none has one.
   */
  rightClick(node: FakeFabricNode): Promise<FakeContextMenu | null>;
  /**
   * Drag files from Finder onto `node` and drop them: `(fileDragEnter)`, then `(fileDrop)` with
   * each file's `file://` url and name.
   */
  dropFiles(node: FakeFabricNode, paths: readonly string[]): Promise<void>;
  /**
   * The close button or Cmd-W on a window, the focused one or else the first when none is given.
   * Resolves whether it closed: a `canClose` guard can keep it.
   */
  closeWindow(window?: TestWindow): Promise<boolean>;
  /** Cmd-Q: every window's guards, then `willQuit`. Resolves whether the app agreed to quit. */
  quit(): Promise<boolean>;
  /** A click on the Dock icon with no window open, which opens the main window. */
  reopen(): Promise<void>;
  /** Open the app with `url`, as a link to its scheme in another app does. */
  openUrl(url: string): Promise<void>;
  /** Scroll with a mouse wheel or a trackpad: `(wheel)`. */
  wheel(node: FakeFabricNode, delta: { deltaX?: number; deltaY?: number }): Promise<void>;
  /**
   * Press a chord, written as `[shortcut]` writes one (`mod+k`, `mod+shift+z`), on the OS the
   * render is on. The desktop host matches it against the app's shortcuts and menu key
   * equivalents, and a focused text input keeps the editing keys. Whether a shortcut took it.
   */
  keyboard(shortcut: string): Promise<boolean>;
  /**
   * Move keyboard focus to the next view that takes it, in the order the views are in, or the one
   * before with `shift`. The focus arrives from the keyboard, so `:focus-visible` matches.
   */
  tab(options?: { shift?: boolean }): Promise<void>;
}

export const desktopUserEvent: DesktopUserEvent = {
  hover: (node) => moveTo(node, ownerOf(node)),
  unhover: (node) => moveTo(null, ownerOf(node)),
  async dblClick(node) {
    emit(node, 'topDoubleClick', MOUSE);
    await settle();
  },
  async rightClick(node) {
    emit(node, 'topContextMenu', MOUSE);
    await settle();
    return contextMenuOf(node);
  },
  async dropFiles(node, paths) {
    const files = paths.map((file) => ({
      uri: `file://${file.split('/').map(encodeURIComponent).join('/')}`,
      name: file.split('/').at(-1) ?? file,
    }));
    emit(node, 'topFileDragEnter', { files });
    emit(node, 'topFileDrop', { files });
    await settle();
  },
  async closeWindow(window) {
    const { owner, windows } = hostWindows();
    const open = windows.windows.filter((one) => one.open);
    const focused = owner.applicationRef.injector.get(AppWindows).focused()?.surface;
    const surface = window?.surface ?? focused ?? open[0]?.surface;
    const target = open.find((one) => one.surface === surface);
    if (!target) return false;
    windows.emit({ type: 'closeRequest', surface: target.surface });
    await answered(() => !target.open);
    return !target.open;
  },
  async quit() {
    const { windows } = hostWindows();
    const before = windows.quitAnswers.length;
    windows.emit({ type: 'quitRequest' });
    await answered(() => windows.quitAnswers.length > before);
    return windows.quitAnswers.at(-1) === true && windows.quitAnswers.length > before;
  },
  async reopen() {
    const { windows } = hostWindows();
    windows.emit({ type: 'reopen' });
    await answered(() => windows.windows.some((one) => one.open));
  },
  async openUrl(url) {
    const links = lastRender().applicationRef.injector.get(
      DeepLinks.SOURCE,
    ) as Partial<FakeDeepLinks>;
    if (!links.emit) {
      throw new Error(
        'The render has no deep links to open: render with os: "macos", or provide ' +
          'provideDesktopFakes().',
      );
    }
    links.emit(url);
    await settle();
  },
  async wheel(node, { deltaX = 0, deltaY = 0 }) {
    emit(node, 'topWheel', { deltaX, deltaY, deltaZ: 0, deltaMode: 0 });
    await settle();
  },
  async keyboard(shortcut) {
    const owner = lastRender();
    const injector = owner.applicationRef.injector;
    const os = injector.get(OS);
    const chord = chordOf(shortcut, os);
    const host = injector.get(Menus.SOURCE, null) as Partial<FakeMenus> | null;
    const focus = focused.get(owner);
    const took = host?.press?.(chord, focus ? isTextInput(focus) : false) ?? false;
    await settle();
    return took;
  },
  async tab({ shift = false } = {}) {
    const owner = lastRender();
    const order = flatten(owner.roots()).filter(focusable);
    if (order.length === 0) return;
    const from = focused.get(owner) ?? null;
    const at = from ? order.findIndex((node) => node.reactTag === from.reactTag) : -1;
    const step = shift ? -1 : 1;
    const next =
      order[
        at === -1 ? (shift ? order.length - 1 : 0) : (at + step + order.length) % order.length
      ]!;
    if (from) emit(from, 'topBlur');
    emit(next, 'topFocus', { focusVisible: true });
    focused.set(owner, next);
    await settle();
  },
};
