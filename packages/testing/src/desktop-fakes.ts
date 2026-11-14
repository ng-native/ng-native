/**
 * Recording fakes of the desktop host's services, for a test of an app on macOS: what the app
 * sends the host (windows, the menu bar, shortcuts, the Dock menu, tray icons, spawned programs)
 * is recorded for the test to read, and the test plays what the host would send back.
 *
 * `render(X, { os: 'macos' })` provides them, all but the windows'; `provideDesktopFakes()` provides them to a render
 * or an `injectService` on any OS, and a test that wants its own fake of one provides that instead.
 */
import type { Provider } from '@angular/core';
import {
  AppWindows,
  Dock,
  Menus,
  Processes,
  Tray,
  type KeyChord,
  type ParsedShortcut,
  type NativeDock,
  type NativeMenuEntry,
  type NativeMenuEvent,
  type NativeMenus,
  type NativeProcesses,
  type NativeShortcut,
  type NativeTray,
  type NativeTrayEvent,
  type NativeTrayIcon,
  type NativeWindowEvent,
  type NativeWindowRequest,
  type NativeWindows,
  type ProcessEvent,
  type SpawnCapability,
} from '@ng-native/device';

/** Whether `chord` presses `shortcut`, as the host matches them: the key, and exactly its modifiers. */
function presses(shortcut: ParsedShortcut, chord: KeyChord): boolean {
  const key = chord.key.length === 1 ? chord.key.toLowerCase() : chord.key;
  return (
    key === shortcut.key &&
    Boolean(chord.meta) === shortcut.meta &&
    Boolean(chord.ctrl) === shortcut.ctrl &&
    Boolean(chord.alt) === shortcut.alt &&
    Boolean(chord.shift) === shortcut.shift
  );
}

/** The id of the enabled menu item, at any depth, whose shortcut `chord` presses. */
function keyEquivalent(entries: readonly NativeMenuEntry[], chord: KeyChord): string | null {
  for (const entry of entries) {
    if ('separator' in entry) continue;
    if (entry.shortcut && !entry.disabled && presses(entry.shortcut, chord)) return entry.id;
    const inner = keyEquivalent(entry.items ?? [], chord);
    if (inner) return inner;
  }
  return null;
}

/** A set of listeners a fake host sends its events to. */
function channel<E>() {
  const listeners = new Set<(event: E) => void>();
  return {
    subscribe(listener: (event: E) => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit(event: E): void {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

/** A window the fake host opened. */
export interface FakeWindow {
  readonly surface: number;
  readonly request: NativeWindowRequest;
  title: string;
  open: boolean;
}

/** The desktop host's windows, recorded: what was opened, closed, focused and retitled. */
export interface FakeWindows extends NativeWindows {
  readonly windows: FakeWindow[];
  /** Whether the app answered the last `quitRequest`, and how. */
  readonly quitAnswers: boolean[];
  /** Send an event, as the host would: a close button, Cmd-Q, a Dock click. */
  emit(event: NativeWindowEvent): void;
}

export function fakeWindows(): FakeWindows {
  const events = channel<NativeWindowEvent>();
  const windows: FakeWindow[] = [];
  const quitAnswers: boolean[] = [];
  let next = 100;
  const find = (surface: number) => windows.find((window) => window.surface === surface);
  return {
    windows,
    quitAnswers,
    emit: events.emit,
    subscribe: events.subscribe,
    open: async (request) => {
      const surface = next++;
      windows.push({ surface, request, title: request.title, open: true });
      return surface;
    },
    close: (surface) => {
      const window = find(surface);
      if (window) window.open = false;
    },
    focus: (surface) => events.emit({ type: 'focus', surface }),
    setTitle: (surface, title) => {
      const window = find(surface);
      if (window) window.title = title;
    },
    quit: () => events.emit({ type: 'quitRequest' }),
    answerQuit: (proceed) => void quitAnswers.push(proceed),
  };
}

/** The desktop host's menu bar and shortcuts, recorded, with key presses matched as the host does. */
export interface FakeMenus extends NativeMenus {
  /** The menu bar as it was last sent. */
  readonly menuBarGroups: readonly { label: string; menuRole?: string; items: NativeMenuEntry[] }[];
  /** The shortcuts as they were last sent. */
  readonly shortcuts: readonly NativeShortcut[];
  /** Choose a menu item by the id it was sent with. */
  select(id: string): void;
  /**
   * Press a chord, as the host matches it against the shortcuts it was sent. Whether one matched.
   * `textInputFocused` is whether a text input has the focus, for the editing-key rule.
   */
  press(chord: KeyChord, textInputFocused?: boolean): boolean;
  emit(event: NativeMenuEvent): void;
}

export function fakeMenus(options: { menuBar?: boolean; appName?: string } = {}): FakeMenus {
  const events = channel<NativeMenuEvent>();
  const state = {
    menuBarGroups: [] as FakeMenus['menuBarGroups'],
    shortcuts: [] as readonly NativeShortcut[],
  };
  return {
    menuBar: options.menuBar ?? true,
    appName: options.appName ?? 'App',
    get menuBarGroups() {
      return state.menuBarGroups;
    },
    get shortcuts() {
      return state.shortcuts;
    },
    setMenuBar: (groups) => void (state.menuBarGroups = groups as FakeMenus['menuBarGroups']),
    setShortcuts: (shortcuts) => void (state.shortcuts = shortcuts),
    subscribe: events.subscribe,
    emit: events.emit,
    select: (id) => events.emit({ type: 'menuSelect', id }),
    press(chord, textInputFocused = false) {
      const found = state.shortcuts.find((shortcut) => presses(shortcut.chord, chord));
      if (found) {
        events.emit({ type: 'shortcut', id: found.id, textInputFocused });
        return true;
      }
      // A drawn menu bar's key equivalents are the menus', which AppKit matches after the app's.
      const item = keyEquivalent(
        state.menuBarGroups.flatMap((group) => group.items),
        chord,
      );
      if (item) events.emit({ type: 'menuSelect', id: item });
      return item !== null;
    },
  };
}

/** The Dock, recorded: its menu and the bounces asked for. */
export interface FakeDock extends NativeDock {
  readonly menu: readonly NativeMenuEntry[] | null;
  /** Each bounce asked for, `critical` or not, and whether it was cancelled. */
  readonly bounces: { critical: boolean; cancelled: boolean }[];
  /** Choose an item of the Dock menu by the id it was sent with. */
  select(id: string): void;
}

export function fakeDock(): FakeDock {
  const events = channel<{ type: 'menuSelect'; id: string }>();
  const state = { menu: null as readonly NativeMenuEntry[] | null };
  const bounces: FakeDock['bounces'] = [];
  return {
    get menu() {
      return state.menu;
    },
    bounces,
    setMenu: (entries) => void (state.menu = entries),
    bounce: (critical) => bounces.push({ critical, cancelled: false }) - 1,
    cancelBounce: (id) => {
      const bounce = bounces[id];
      if (bounce) bounce.cancelled = true;
    },
    subscribe: events.subscribe,
    select: (id) => events.emit({ type: 'menuSelect', id }),
  };
}

/** The menu bar's status items, recorded. */
export interface FakeTray extends NativeTray {
  readonly icons: readonly NativeTrayIcon[];
  /** Click an icon that has no menu. */
  press(icon: string): void;
  /** Choose an item of an icon's menu. */
  select(icon: string, id: string): void;
}

export function fakeTray(): FakeTray {
  const events = channel<NativeTrayEvent>();
  const state = { icons: [] as readonly NativeTrayIcon[] };
  return {
    get icons() {
      return state.icons;
    },
    setIcons: (icons) => void (state.icons = icons),
    subscribe: events.subscribe,
    press: (icon) => events.emit({ type: 'press', icon }),
    select: (icon, id) => events.emit({ type: 'menuSelect', icon, id }),
  };
}

/** What a fake program does when spawned: what it writes, and how it ends. */
export interface FakeProgram {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
}

/** A program the fake host was asked to run. */
export interface FakeSpawn {
  readonly handle: number;
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string | null;
  readonly env: Readonly<Record<string, string>>;
  /** What the app wrote to its standard input. */
  readonly stdin: string[];
  stdinClosed: boolean;
  killedWith: string | null;
}

/** The desktop host's processes, recorded, with programs the test scripts. */
export interface FakeProcesses extends NativeProcesses {
  readonly spawned: FakeSpawn[];
  /** Send output or an exit, as the host would for a running program. */
  emit(event: ProcessEvent): void;
}

export interface FakeProcessesOptions {
  readonly env?: Readonly<Record<string, string>>;
  /** The declared variables a spawned program may be given. `env`'s names when unset. */
  readonly envNames?: readonly string[];
  readonly spawn?: readonly SpawnCapability[];
  /** Where each declared bare name was pinned. Every one at `/usr/bin` when unset. */
  readonly resolved?: Readonly<Record<string, string | null>>;
  /**
   * What a program does, by the path it runs from, answered once it starts. A program with none
   * runs until the test sends its exit.
   */
  readonly programs?: Readonly<Record<string, FakeProgram>>;
}

export function fakeProcesses(options: FakeProcessesOptions = {}): FakeProcesses {
  const events = channel<ProcessEvent>();
  const spawned: FakeSpawn[] = [];
  const declared = options.spawn ?? [];
  const resolved =
    options.resolved ??
    Object.fromEntries(
      declared
        .filter(({ program }) => !program.startsWith('/'))
        .map(({ program }) => [program, `/usr/bin/${program}`]),
    );
  const find = (handle: number) => spawned.find((spawn) => spawn.handle === handle);
  return {
    env: options.env ?? {},
    envNames: options.envNames ?? Object.keys(options.env ?? {}),
    spawnCapabilities: declared,
    resolved,
    spawned,
    emit: events.emit,
    subscribe: events.subscribe,
    spawn: async (program, args, cwd, env) => {
      const handle = spawned.length + 1;
      spawned.push({
        handle,
        program,
        args,
        cwd,
        env,
        stdin: [],
        stdinClosed: false,
        killedWith: null,
      });
      const script = options.programs?.[program];
      if (script) {
        setTimeout(() => {
          if (script.stdout) events.emit({ type: 'stdout', handle, data: script.stdout });
          if (script.stderr) events.emit({ type: 'stderr', handle, data: script.stderr });
          events.emit({ type: 'exit', handle, code: script.code ?? 0, signal: null });
        });
      }
      return handle;
    },
    write: (handle, data) => void find(handle)?.stdin.push(data),
    closeStdin: (handle) => {
      const spawn = find(handle);
      if (spawn) spawn.stdinClosed = true;
    },
    kill: (handle, signal) => {
      const spawn = find(handle);
      if (!spawn) return;
      spawn.killedWith = signal;
      setTimeout(() => events.emit({ type: 'exit', handle, code: null, signal }));
    },
  };
}

/** The fakes a render on a desktop OS gets, each one replaceable. */
export interface DesktopFakes {
  readonly windows?: FakeWindows;
  readonly menus?: FakeMenus;
  readonly dock?: FakeDock;
  readonly tray?: FakeTray;
  readonly processes?: FakeProcesses;
}

/**
 * Providers that put the recording fakes in place of the desktop host's menus, Dock, tray and
 * processes. A fake given here is used as it is; the rest are made new. The windows' fake goes in
 * only when one is given: with it, the root component waits for `AppWindows` to open the main
 * window, where a render without it mounts on the render's own surface.
 */
export function provideDesktopFakes(fakes: DesktopFakes = {}): Provider[] {
  return [
    ...(fakes.windows ? [{ provide: AppWindows.SOURCE, useValue: fakes.windows }] : []),
    { provide: Menus.SOURCE, useValue: fakes.menus ?? fakeMenus() },
    { provide: Dock.SOURCE, useValue: fakes.dock ?? fakeDock() },
    { provide: Tray.SOURCE, useValue: fakes.tray ?? fakeTray() },
    { provide: Processes.SOURCE, useValue: fakes.processes ?? fakeProcesses() },
  ];
}
