/**
 * Several windows from one app: `AppWindows`, `CURRENT_WINDOW`, `provideMainWindow` and
 * `provideAppLifecycle`, on a fake host.
 *
 * The host contract (`NativeWindows` in `@ng-native/device`, the `NgNativeWindows` module):
 * - The app's runnable starts on a surface the host never shows. Where the module's constant
 *   `multipleWindows` is true, `mount` renders nothing there and opens the main window instead.
 * - `open(request)` makes a window with its own surface and resolves the surface's id. The request
 *   has `key` (what the frame autosaves under: `main`, the outlet, the `restoreKey`, or null),
 *   `title` and the size options. The host shows the window once its first frame commits.
 * - `close(surface)` closes it and stops its surface; `focus`, `setTitle` do what they say.
 * - The host sends `ngNativeWindows` events on `DeviceEventEmitter`: `focus`, `resize`,
 *   `closeRequest` (the close button, Cmd-W), `closed` (the OS closed it), `quitRequest`
 *   (Cmd-Q, logout) and `reopen` (a Dock click with no window). It never closes a window or quits
 *   on its own: it waits for `close(surface)` or `answerQuit(proceed)`.
 * - `quit()` starts quitting as Cmd-Q does, so it comes back as a `quitRequest`.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import {
  AppLifecycle,
  AppWindows,
  provideAppLifecycle,
  provideMainWindow,
  type NativeWindowEvent,
  type NativeWindowRequest,
  type NativeWindows,
  type RestoredWindow,
  type WindowRestoreStore,
  WINDOW_RESTORE_STORE,
  provideRestorableWindows,
} from '@ng-native/device';
import type { Conditions, Engine, StyleSheet } from '@ng-native/fabric';
import { mount, type MountResult } from '@ng-native/platform';
import { provideNativeRouter } from '@ng-native/router';
import {
  compileCss,
  createFakeFabric,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

let fixtures: Record<string, Type<unknown>>;
before(async () => {
  fixtures = (await compileFixture('fixtures/app-windows.ts')) as Record<string, Type<unknown>>;
});

/** A host that opens a surface a call, and records what it was asked. */
function fakeHost() {
  let next = 11;
  const listeners = new Set<(event: NativeWindowEvent) => void>();
  const opened: NativeWindowRequest[] = [];
  const closed: number[] = [];
  const focused: number[] = [];
  const titles: [number, string][] = [];
  const answers: boolean[] = [];
  let quits = 0;
  const native: NativeWindows = {
    open: async (request) => {
      opened.push(request);
      const surface = next;
      next += 10;
      return surface;
    },
    close: (surface) => void closed.push(surface),
    focus: (surface) => void focused.push(surface),
    setTitle: (surface, title) => void titles.push([surface, title]),
    quit: () => {
      quits++;
      // As the host does: quitting comes back as a request to answer.
      send({ type: 'quitRequest' });
    },
    answerQuit: (proceed) => void answers.push(proceed),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const send = (event: NativeWindowEvent) => listeners.forEach((listener) => listener(event));
  return {
    native,
    send,
    opened,
    closed,
    focused,
    titles,
    answers,
    quits: () => quits,
  };
}

let apps: MountResult[] = [];
afterEach(() => {
  for (const app of apps) app.applicationRef.destroy();
  apps = [];
});

function start(
  root: string,
  host: ReturnType<typeof fakeHost>,
  providers: unknown[] = [],
  conditions?: Conditions,
) {
  const fabric = createFakeFabric();
  const app = mount(1, fixtures[root]!, fabric, {
    ...(conditions && { conditions }),
    providers: [{ provide: AppWindows.SOURCE, useValue: host.native }, ...(providers as never[])],
  });
  apps.push(app);
  const windows = app.applicationRef.injector.get(AppWindows);
  return { fabric, app, windows };
}

/** Every `RawText` under the node, in order. */
const textContent = (node: FakeFabricNode): string =>
  node.viewName === 'RawText'
    ? String(node.props['text'] ?? '')
    : node.children.map(textContent).join('');

/** The first committed view on `surface` with `testID`. */
function byTestId(fabric: FakeFabric, surface: number, id: string): FakeFabricNode | undefined {
  const find = (nodes: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
    for (const node of nodes) {
      if (node.props['testID'] === id) return node;
      const hit = find(node.children);
      if (hit) return hit;
    }
    return undefined;
  };
  return find(fabric.committedOn(surface));
}

const textOn = (fabric: FakeFabric, surface: number, id: string) => {
  const node = byTestId(fabric, surface, id);
  return node ? textContent(node).trim() : undefined;
};

async function press(fabric: FakeFabric, node: FakeFabricNode | undefined) {
  assert.ok(node, 'the view to press is committed');
  fabric.emit(node, 'topTouchStart', { touches: [{}], changedTouches: [{}] });
  fabric.emit(node, 'topTouchEnd', { touches: [], changedTouches: [{}] });
  await settle();
}

describe('the main window', () => {
  it('renders the root component in a window, and nothing on the app surface', async () => {
    const host = fakeHost();
    const { fabric, windows } = start('MainWindowApp', host, [
      provideMainWindow({ width: 800, height: 600, titleBar: 'transparent', title: 'Notes' }),
    ]);
    await settle();
    assert.deepEqual(host.opened, [
      { key: 'main', title: 'Notes', width: 800, height: 600, titleBar: 'transparent' },
    ]);
    assert.equal(fabric.committedOn(1).length, 0, 'the app surface shows nothing');
    assert.equal(textOn(fabric, 11, 'main-count'), '0');
    assert.equal(windows.windows().length, 1);
    assert.equal(windows.windows()[0]!.key, 'main');
  });

  it('starts with no window under autoOpen: false, and opens one when asked', async () => {
    const host = fakeHost();
    const { fabric, windows, app } = start('MainWindowApp', host, [
      provideMainWindow({ autoOpen: false }),
    ]);
    await settle();
    assert.equal(host.opened.length, 0);
    assert.throws(() => app.componentRef, /no window open/);
    const main = await windows.openMain();
    await settle();
    assert.equal(main?.surface, 11);
    assert.equal(textOn(fabric, 11, 'main-count'), '0');
    assert.equal(app.componentRef.instance?.constructor, fixtures['MainWindowApp']);
  });

  it('opens again on a Dock reopen once it has closed, and the app keeps running', async () => {
    const host = fakeHost();
    const { fabric, windows } = start('MainWindowApp', host);
    await settle();
    host.send({ type: 'closeRequest', surface: 11 });
    await settle();
    assert.deepEqual(host.closed, [11]);
    assert.equal(windows.windows().length, 0);
    assert.equal(host.quits(), 0, 'macOS keeps an app with no window running');
    host.send({ type: 'reopen' });
    await settle();
    assert.equal(host.opened.length, 2);
    assert.equal(textOn(fabric, 21, 'main-count'), '0');
  });

  it('renders a mobile app unchanged where the OS has one window', async () => {
    const fabric = createFakeFabric();
    const app = mount(1, fixtures['MainWindowApp']!, fabric, {
      providers: [{ provide: AppWindows.SOURCE, useValue: null }],
    });
    apps.push(app);
    await settle();
    assert.equal(textOn(fabric, 1, 'main-count'), '0');
    const windows = app.applicationRef.injector.get(AppWindows);
    assert.equal(windows.available(), false);
    assert.equal(await windows.open(fixtures['NoteWindow']!), null, 'an inert open is null');
  });
});

describe('component windows', () => {
  it('share root services and one change detection with every other window', async () => {
    const host = fakeHost();
    const { fabric, windows } = start('MainWindowApp', host);
    await settle();
    const note = await windows.open(fixtures['NoteWindow']!, {
      inputs: { name: 'Groceries' },
      title: 'Groceries',
      width: 300,
    });
    await settle();
    assert.equal(note?.surface, 21);
    assert.deepEqual(host.opened[1], { key: null, title: 'Groceries', width: 300 });
    assert.equal(textOn(fabric, 21, 'note'), 'Groceries 0');
    // A press in the note window changes the root service; the main window shows it too.
    await press(fabric, byTestId(fabric, 21, 'note-add'));
    assert.equal(textOn(fabric, 21, 'note'), 'Groceries 1');
    assert.equal(textOn(fabric, 11, 'main-count'), '1');
    // And the other way round, with the main window's own events.
    await press(fabric, byTestId(fabric, 11, 'add'));
    assert.equal(textOn(fabric, 21, 'note'), 'Groceries 2');
  });

  it('opens as many as are asked for, and autosaves only one with a restoreKey', async () => {
    const host = fakeHost();
    const { windows } = start('MainWindowApp', host);
    const first = await windows.open(fixtures['NoteWindow']!, { restoreKey: 'note-1' });
    await windows.open(fixtures['NoteWindow']!, { restoreKey: 'note-2', autosave: false });
    await windows.open(fixtures['NoteWindow']!);
    assert.deepEqual(
      host.opened.map((request) => request.key),
      ['main', 'note-1', null, null],
    );
    assert.equal(windows.windows().length, 4);
    // A restoreKey names one window: asked again, the open one comes to the front.
    assert.equal(await windows.open(fixtures['NoteWindow']!, { restoreKey: 'note-1' }), first);
    assert.deepEqual(host.focused, [first!.surface]);
  });

  it('keeps a window whose canClose guard says no, and closes it once it agrees', async () => {
    const host = fakeHost();
    const { fabric, windows } = start('MainWindowApp', host);
    await settle();
    const note = (await windows.open(fixtures['NoteWindow']!, { inputs: { name: 'Draft' } }))!;
    await settle();
    assert.equal(windows.windows().length, 2);
    const component = findNote(windows);
    component.unsaved.set(true);
    host.send({ type: 'closeRequest', surface: note.surface });
    await settle();
    assert.deepEqual(host.closed, [], 'the host was not told to close it');
    assert.equal(textOn(fabric, 21, 'note'), 'Draft 0');
    component.unsaved.set(false);
    assert.equal(await note.close(), true);
    assert.deepEqual(host.closed, [21]);
    await note.closed;
    assert.equal(windows.windows().length, 1);
  });

  it('takes down a window the OS closed without asking its guards', async () => {
    const host = fakeHost();
    const { windows } = start('MainWindowApp', host);
    const note = (await windows.open(fixtures['NoteWindow']!))!;
    await settle();
    findNote(windows).unsaved.set(true);
    host.send({ type: 'closed', surface: note.surface });
    await note.closed;
    assert.equal(windows.windows().length, 1);
    assert.deepEqual(host.closed, [], 'the host closed it already');
  });

  it('follows the focus, the title, and a closed window stops taking events', async () => {
    const host = fakeHost();
    const { fabric, windows } = start('MainWindowApp', host);
    await settle();
    const note = (await windows.open(fixtures['NoteWindow']!))!;
    await settle();
    host.send({ type: 'focus', surface: note.surface });
    assert.equal(note.focused(), true);
    assert.equal(windows.focused(), note);
    note.setTitle('Renamed');
    assert.equal(note.title(), 'Renamed');
    assert.deepEqual(host.titles, [[21, 'Renamed']]);
    const button = byTestId(fabric, 21, 'note-add');
    await note.close();
    assert.equal(windows.focused(), null);
    await press(fabric, button);
    assert.equal(textOn(fabric, 11, 'main-count'), '0', 'the closed window pressed nothing');
  });
});

/** The note window opened last. */
function findNote(_windows: AppWindows): { unsaved: { set(value: boolean): void } } {
  const made = (fixtures['NoteWindow'] as unknown as { made: { unsaved: never }[] }).made;
  return made.at(-1)!;
}

describe('what each window has of its own', () => {
  type Made = {
    screen: { window(): { width: number }; compact(): boolean };
    safeArea: unknown;
    engine: {
      conditions: Conditions | undefined;
      root: { classList: { contains(name: string): boolean } };
    };
  };
  const made = () => (fixtures['ScreenWindow'] as unknown as { made: Made[] }).made;
  const light: Conditions = { width: 1200, height: 800, colorScheme: 'light' };

  it('sizes its Screen and its media queries by the window, not the app', async () => {
    const host = fakeHost();
    const { fabric, windows } = start('MainWindowApp', host, [], light);
    const narrow = (await windows.open(fixtures['ScreenWindow']!))!;
    const wide = (await windows.open(fixtures['ScreenWindow']!))!;
    await settle();
    const [first, second] = made().slice(-2);
    host.send({ type: 'resize', surface: narrow.surface, width: 400, height: 600, scale: 2 });
    host.send({ type: 'resize', surface: wide.surface, width: 1000, height: 700 });
    await settle();
    assert.equal(first!.screen.window().width, 400);
    assert.equal(first!.screen.compact(), true);
    assert.equal(second!.screen.window().width, 1000);
    assert.equal(textOn(fabric, narrow.surface, 'size'), '400');
    assert.equal(first!.engine.conditions?.width, 400);
    assert.equal(first!.engine.conditions?.pixelRatio, 2);
    assert.notEqual(first!.safeArea, second!.safeArea, 'a safe area each');
  });

  it('follows a change of colour scheme, keeping its own size, and the dark class', async () => {
    const host = fakeHost();
    const { windows, app } = start('MainWindowApp', host, [], light);
    const note = (await windows.open(fixtures['ScreenWindow']!))!;
    await settle();
    host.send({ type: 'resize', surface: note.surface, width: 400, height: 600 });
    const window = made().at(-1)!;
    app.engine.addClass(app.engine.root, 'dark');
    app.engine.updateConditions({ ...light, colorScheme: 'dark' });
    assert.equal(window.engine.conditions?.colorScheme, 'dark');
    assert.equal(window.engine.conditions?.width, 400, 'its own size');
    assert.equal(window.engine.root.classList.contains('dark'), true);
    app.engine.removeClass(app.engine.root, 'dark');
    app.engine.updateConditions(light);
    assert.equal(window.engine.conditions?.colorScheme, 'light');
    assert.equal(window.engine.root.classList.contains('dark'), false);
  });

  it('has the platform class the app has on its root', async () => {
    const host = fakeHost();
    const { windows, app } = start('MainWindowApp', host);
    await windows.open(fixtures['ScreenWindow']!);
    const platform = [...(app.engine.root.classes ?? [])].find((name) =>
      name.startsWith('platform-'),
    );
    assert.ok(platform);
    assert.equal(made().at(-1)!.engine.root.classList.contains(platform), true);
  });
});

describe('the app engine state each window shares', () => {
  type Made = { engine: unknown };
  const made = () => (fixtures['ScreenWindow'] as unknown as { made: Made[] }).made;
  const brand = (window: Made) => (window.engine as Engine).token('--brand');
  const sheet = (css: string) => compileCss(css, 'shared.css') as StyleSheet;

  it('gives a window already open a global sheet the app adds, and takes it away again', async () => {
    const host = fakeHost();
    const { windows, app } = start('MainWindowApp', host);
    await windows.open(fixtures['ScreenWindow']!);
    await settle();
    const window = made().at(-1)!;
    const added = sheet(':root { --brand: red }');
    assert.equal(brand(window), undefined);
    app.engine.addGlobalSheet(added);
    assert.equal(brand(window), 'red');
    const swapped = sheet(':root { --brand: blue }');
    app.engine.addGlobalSheet(swapped, added);
    assert.equal(brand(window), 'blue', 'a replaced sheet is replaced in the window');
    app.engine.removeGlobalSheet(swapped);
    assert.equal(brand(window), undefined, 'a removed sheet is gone from the window');
  });

  it('gives a window opened after the sheet the sheet, and not one removed before', async () => {
    const host = fakeHost();
    const { windows, app } = start('MainWindowApp', host);
    const kept = sheet(':root { --brand: red }');
    const gone = sheet(':root { --other: green }');
    app.engine.addGlobalSheet(kept);
    app.engine.addGlobalSheet(gone);
    app.engine.removeGlobalSheet(gone);
    await windows.open(fixtures['ScreenWindow']!);
    await settle();
    const window = made().at(-1)!;
    assert.equal(brand(window), 'red');
    assert.equal((window.engine as Engine).token('--other'), undefined);
  });

  it('keeps a window that has closed from hearing of a sheet', async () => {
    const host = fakeHost();
    const { windows, app } = start('MainWindowApp', host);
    const note = (await windows.open(fixtures['ScreenWindow']!))!;
    await settle();
    const window = made().at(-1)!;
    await note.close();
    await settle();
    app.engine.addGlobalSheet(sheet(':root { --brand: red }'));
    assert.equal(brand(window), undefined);
  });

  it('gives each window the tokens the app has, opened before or after', async () => {
    const host = fakeHost();
    const { windows, app } = start('MainWindowApp', host);
    await windows.open(fixtures['ScreenWindow']!);
    await settle();
    app.engine.updateTokens({ '--hairline': { length: 0.5 } });
    app.engine.updateTokens({ '--extra': { length: 2 } });
    const before = made().at(-1)!;
    await windows.open(fixtures['ScreenWindow']!);
    await settle();
    const after = made().at(-1)!;
    for (const window of [before, after]) {
      const engine = window.engine as Engine;
      assert.equal(engine.token('--hairline'), '0.5px');
      assert.equal(engine.token('--extra'), '2px');
    }
  });
});

describe('the app lifecycle', () => {
  it('quits after the last window closes under quitWhenLastWindowCloses', async () => {
    const host = fakeHost();
    start('MainWindowApp', host, [provideAppLifecycle({ quitWhenLastWindowCloses: true })]);
    await settle();
    host.send({ type: 'closeRequest', surface: 11 });
    await settle();
    assert.equal(host.quits(), 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(host.answers, [true]);
  });

  it('defaults to the OS: macOS keeps running, a later desktop OS quits', async () => {
    const { injectService } = await import('@ng-native/testing');
    const { OS } = await import('@ng-native/device');
    for (const [os, quits] of [
      ['macos', false],
      ['ios', false],
      ['web', true],
    ] as const) {
      const lifecycle = injectService(AppLifecycle, { providers: [{ provide: OS, useValue: os }] });
      assert.equal(lifecycle.quitWhenLastWindowCloses, quits, os);
    }
  });

  it('asks every guard before quitting, and keeps every window if one says no', async () => {
    const host = fakeHost();
    const { windows } = start('MainWindowApp', host);
    await windows.open(fixtures['NoteWindow']!);
    await settle();
    findNote(windows).unsaved.set(true);
    host.send({ type: 'quitRequest' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(host.answers, [false]);
    assert.equal(windows.windows().length, 2);
  });

  it('quits when the app asks, through the guards as Cmd-Q does', async () => {
    const host = fakeHost();
    const { windows } = start('MainWindowApp', host);
    await windows.open(fixtures['NoteWindow']!);
    await settle();
    findNote(windows).unsaved.set(true);
    windows.quit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(host.quits(), 1);
    assert.deepEqual(host.answers, [false], 'the unsaved note kept the app');
    findNote(windows).unsaved.set(false);
    windows.quit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(host.answers, [false, true]);
  });

  it('runs willQuit after the guards and waits for it, up to its deadline', async () => {
    const host = fakeHost();
    const { app } = start('MainWindowApp', host);
    await settle();
    const lifecycle = app.applicationRef.injector.get(AppLifecycle);
    const steps: string[] = [];
    let finish!: () => void;
    lifecycle.willQuit(
      () =>
        new Promise<void>((resolve) => {
          steps.push('saving');
          finish = () => {
            steps.push('saved');
            resolve();
          };
        }),
    );
    host.send({ type: 'quitRequest' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(host.answers, [], 'the host waits for willQuit');
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(steps, ['saving', 'saved']);
    assert.deepEqual(host.answers, [true]);
    // A handler that never settles does not keep the app past the deadline.
    lifecycle.willQuit(() => new Promise(() => {}));
    const started = Date.now();
    await lifecycle.runWillQuit(20);
    assert.ok(Date.now() - started < 1000);
  });
});

describe('route windows', () => {
  const routes = () => [
    { path: '', component: fixtures['HomePage']! },
    { path: 'general', outlet: 'preferences', component: fixtures['GeneralPage']! },
    {
      path: 'accounts',
      outlet: 'preferences',
      component: fixtures['AccountsShell']!,
      children: [{ path: '', component: fixtures['GeneralPage']! }],
    },
  ];

  it('render a named outlet of the one Router, and the URL holds them', async () => {
    const host = fakeHost();
    const { fabric, windows, app } = start('RoutedApp', host, [provideNativeRouter(routes())]);
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    assert.equal(textOn(fabric, 11, 'home'), 'Home');
    const prefs = await windows.open({ outlet: 'preferences', path: 'general', width: 500 });
    await settle();
    assert.deepEqual(host.opened[1], { key: 'preferences', title: '', width: 500 });
    assert.equal(textOn(fabric, 21, 'general'), 'General 0');
    const { Router } = await import('@angular/router');
    const router = app.applicationRef.injector.get(Router);
    assert.equal(router.url, '/(preferences:general)');
    // One of a kind: asked again, the open one comes to the front.
    const again = await windows.open({ outlet: 'preferences', path: 'general' });
    assert.equal(again, prefs);
    assert.deepEqual(host.focused, [21]);
    assert.equal(host.opened.length, 2);
    await prefs!.close();
    await settle();
    assert.equal(router.url, '/', 'closing the window clears its outlet');
    assert.equal(textOn(fabric, 11, 'home'), 'Home');
  });

  it('leave an outlet in one of their pages as the primary outlet of that page', async () => {
    const host = fakeHost();
    const { fabric, windows } = start('RoutedApp', host, [provideNativeRouter(routes())]);
    await settle();
    await windows.open({ outlet: 'preferences', path: 'accounts' });
    await settle();
    assert.equal(textOn(fabric, 21, 'general'), 'General 0');
  });
});

describe('after a reload or a relaunch', () => {
  /** What the host keeps in the app's preferences, as one launch leaves it for the next. */
  function memoryStore() {
    let saved: readonly RestoredWindow[] = [];
    const store: WindowRestoreStore = {
      read: () => saved,
      write: (windows) => void (saved = structuredClone(windows)),
    };
    return { store, saved: () => saved };
  }
  const routes = () => [
    { path: '', component: fixtures['HomePage']! },
    { path: 'general', outlet: 'preferences', component: fixtures['GeneralPage']! },
  ];
  const launch = (root: string, store: WindowRestoreStore, providers: unknown[] = []) => {
    const host = fakeHost();
    const started = start(root, host, [
      { provide: WINDOW_RESTORE_STORE, useValue: store },
      provideRestorableWindows({ note: fixtures['NoteWindow']! }),
      ...providers,
    ]);
    return { host, ...started };
  };
  const reload = (app: MountResult) => {
    app.applicationRef.destroy();
    apps = apps.filter((one) => one !== app);
  };

  it('opens a restoreKey window again, with its inputs and options, and its key claims the kept one', async () => {
    const { store } = memoryStore();
    const first = launch('MainWindowApp', store);
    await settle();
    await first.windows.open(fixtures['NoteWindow']!, {
      restoreKey: 'note-1',
      inputs: { name: 'Groceries' },
      title: 'Groceries',
      width: 300,
    });
    await first.windows.open(fixtures['NoteWindow']!, { inputs: { name: 'Scratch' } });
    await settle();
    reload(first.app);

    const second = launch('MainWindowApp', store);
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    assert.deepEqual(second.host.opened, [
      { key: 'main', title: '' },
      { key: 'note-1', title: 'Groceries', width: 300 },
    ]);
    assert.equal(textOn(second.fabric, 21, 'note'), 'Groceries 0');
    assert.equal(second.windows.windows()[1]!.key, 'note-1');
  });

  it('does not open a window that was closed, or one whose component is not restorable', async () => {
    const { store, saved } = memoryStore();
    const first = launch('MainWindowApp', store);
    await settle();
    const kept = await first.windows.open(fixtures['NoteWindow']!, { restoreKey: 'a' });
    const closed = await first.windows.open(fixtures['NoteWindow']!, { restoreKey: 'b' });
    const warn = console.warn;
    const warned: unknown[] = [];
    console.warn = (...args: unknown[]) => void warned.push(args[0]);
    try {
      await first.windows.open(fixtures['MainWindowApp']!, { restoreKey: 'c' });
    } finally {
      console.warn = warn;
    }
    assert.match(String(warned[0]), /provideRestorableWindows/);
    await closed!.close();
    // The OS closing one forgets it as well.
    first.host.send({ type: 'closed', surface: kept!.surface });
    await kept!.closed;
    assert.deepEqual(saved(), [{ kind: 'main' }]);
    reload(first.app);

    const second = launch('MainWindowApp', store);
    await settle();
    assert.deepEqual(
      second.host.opened.map((request) => request.key),
      ['main'],
    );
  });

  it('opens the main window again under autoOpen: false where it was open', async () => {
    const { store } = memoryStore();
    const first = launch('MainWindowApp', store, [provideMainWindow({ autoOpen: false })]);
    await settle();
    assert.deepEqual(first.host.opened, []);
    await first.windows.openMain();
    reload(first.app);
    const second = launch('MainWindowApp', store, [provideMainWindow({ autoOpen: false })]);
    await settle();
    assert.deepEqual(
      second.host.opened.map((request) => request.key),
      ['main'],
    );
  });

  it('opens a route window again at the path it last opened', async () => {
    const { store } = memoryStore();
    const first = launch('RoutedApp', store, [provideNativeRouter(routes())]);
    await settle();
    await first.windows.open({ outlet: 'preferences', path: 'general', width: 500 });
    await settle();
    reload(first.app);

    const second = launch('RoutedApp', store, [provideNativeRouter(routes())]);
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    assert.deepEqual(second.host.opened[1], { key: 'preferences', title: '', width: 500 });
    assert.equal(textOn(second.fabric, 21, 'general'), 'General 0');
  });
});
