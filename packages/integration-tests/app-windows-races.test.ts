/**
 * `AppWindows` when its calls overlap: two opens of one key, a mount that throws, a quit whose
 * guards are still deciding when a window opens or a SIGTERM arrives. On a fake host and a fake
 * mounter, so each overlap can be held open while the next call is made.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  APP_BOOTSTRAP_LISTENER,
  Injector,
  createEnvironmentInjector,
  type EnvironmentInjector,
  inputBinding,
  type Type,
  ɵINJECTOR_SCOPE as INJECTOR_SCOPE,
} from '@angular/core';
import {
  AppLifecycle,
  AppWindows,
  WINDOW_MOUNTER,
  WINDOW_NAVIGATOR,
  WINDOW_RESTORE_STORE,
  provideMainWindow,
  provideRestorableWindows,
  type NativeWindowEvent,
  type NativeWindowRequest,
  type NativeWindows,
  type RestoredWindow,
  type WindowMounter,
  type WindowNavigator,
} from '@ng-native/device';
import type { Engine } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { createFakeFabric, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

class Root {}
class Note {}

function fakeHost(opening?: (surface: number, send: (event: NativeWindowEvent) => void) => void) {
  let next = 11;
  const listeners = new Set<(event: NativeWindowEvent) => void>();
  const opened: NativeWindowRequest[] = [];
  const closed: number[] = [];
  const answers: boolean[] = [];
  const native: NativeWindows = {
    open: async (request) => {
      opened.push(request);
      const surface = next;
      next += 10;
      opening?.(surface, send);
      return surface;
    },
    close: (surface) => void closed.push(surface),
    focus: () => {},
    setTitle: () => {},
    quit: () => {},
    answerQuit: (proceed) => void answers.push(proceed),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  function send(event: NativeWindowEvent) {
    listeners.forEach((listener) => listener(event));
  }
  return { native, send, opened, closed, answers };
}

/** A mounter that records what it mounts, and throws for a component in `failing`. */
function fakeMounter(failing = new Set<Type<unknown>>()) {
  const mounted: number[] = [];
  const destroyed: number[] = [];
  const sizes: string[] = [];
  const mounter: WindowMounter = {
    mount: (surface, component) => {
      if (failing.has(component)) throw new Error('mount failed');
      mounted.push(surface);
      return {
        resize: ({ width, height }) => void sizes.push(`${surface} ${width}x${height}`),
        destroy: () => void destroyed.push(surface),
      };
    },
  };
  return { mounter, mounted, destroyed, sizes };
}

const navigator: WindowNavigator = {
  window: () => ({ component: Note, providers: [] }),
  navigate: async () => true,
  clear: async () => true,
};

function start(
  options: {
    failing?: Set<Type<unknown>>;
    store?: RestoredWindow[][];
    navigator?: WindowNavigator;
    opening?: Parameters<typeof fakeHost>[0];
  } = {},
) {
  const host = fakeHost(options.opening);
  const mounter = fakeMounter(options.failing);
  const writes = options.store;
  const injector = createEnvironmentInjector(
    [
      { provide: INJECTOR_SCOPE, useValue: 'root' },
      // Note is written down to open again, so a window of it leaves a restore entry.
      provideRestorableWindows({ Note }),
      { provide: AppWindows.SOURCE, useValue: host.native },
      { provide: WINDOW_MOUNTER, useValue: mounter.mounter },
      { provide: WINDOW_NAVIGATOR, useValue: options.navigator ?? navigator },
      {
        provide: WINDOW_RESTORE_STORE,
        useValue: writes
          ? { read: () => [], write: (all: RestoredWindow[]) => writes.push(all) }
          : null,
      },
    ],
    Injector.NULL as EnvironmentInjector,
  );
  const windows = injector.get(AppWindows);
  windows.launch(Root);
  return { host, mounter, windows, lifecycle: injector.get(AppLifecycle) };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A guard that answers when the test says. */
function heldGuard() {
  let answer!: (value: boolean) => void;
  const answered = new Promise<boolean>((resolve) => (answer = resolve));
  return { guard: () => answered, answer };
}

describe('opening one key twice at once', () => {
  it('opens one window for a restoreKey, even with autosave off', async () => {
    const { host, windows } = start();
    await flush();
    const [first, second] = await Promise.all([
      windows.open(Note, { restoreKey: 'note', autosave: false }),
      windows.open(Note, { restoreKey: 'note', autosave: false }),
    ]);
    assert.equal(host.opened.length, 2, 'the main window and one note');
    assert.equal(first, second);
    assert.equal(windows.windows().length, 2);
  });

  it('opens one main window when openMain is asked while it opens', async () => {
    const { host, windows } = start();
    const again = await windows.openMain();
    await flush();
    assert.equal(host.opened.length, 1);
    assert.equal(windows.windows().length, 1);
    assert.equal(again, windows.windows()[0]);
  });

  it('opens one route window for an outlet asked for twice', async () => {
    const { host, windows } = start();
    await flush();
    const [first, second] = await Promise.all([
      windows.open({ outlet: 'prefs', path: 'general' }),
      windows.open({ outlet: 'prefs', path: 'accounts' }),
    ]);
    assert.equal(host.opened.length, 2, 'the main window and one route window');
    assert.equal(first, second);
  });

  it('opens the key again once an open that failed has settled', async () => {
    const { host, windows } = start({ failing: new Set([Note]) });
    await flush();
    await assert.rejects(windows.open(Note, { restoreKey: 'note' }), /mount failed/);
    await assert.rejects(windows.open(Note, { restoreKey: 'note' }), /mount failed/);
    assert.equal(host.opened.length, 3, 'the second open asked the host again');
  });
});

describe('a route window asked for a path it is refused', () => {
  it('keeps restoring the path it shows', async () => {
    const store: RestoredWindow[][] = [];
    const { windows } = start({
      store,
      navigator: { ...navigator, navigate: async (_outlet, path) => path !== 'privacy' },
    });
    await flush();
    await windows.open({ outlet: 'prefs', path: 'general' });
    await windows.open({ outlet: 'prefs', path: 'privacy' });
    const paths = (writes: RestoredWindow[] | undefined) =>
      (writes ?? []).flatMap((entry) => (entry.kind === 'route' ? [entry.path] : []));
    assert.deepEqual(paths(store.at(-1)), ['general']);
    assert.ok(!store.some((writes) => paths(writes).includes('privacy')), 'never saved');
  });
});

describe('a window whose mount throws', () => {
  it('closes the surface, forgets the window and its restore entry, and rethrows', async () => {
    const store: RestoredWindow[][] = [];
    const { host, windows } = start({ failing: new Set([Note]), store });
    await flush();
    await assert.rejects(windows.open(Note, { restoreKey: 'note' }), /mount failed/);
    assert.deepEqual(host.closed, [21]);
    assert.deepEqual(
      windows.windows().map((window) => window.key),
      ['main'],
    );
    const noted = (writes: RestoredWindow[]) =>
      writes.some((entry) => entry.kind === 'component' && entry.key === 'note');
    assert.ok(store.some(noted), 'the note was written down before its mount threw');
    assert.deepEqual(store.at(-1), [{ kind: 'main' }]);
  });
});

describe('quitting while guards decide', () => {
  it('asks the guard of a window that opened while another guard was deciding', async () => {
    const { host, windows } = start();
    await flush();
    const held = heldGuard();
    windows.windows()[0]!.canClose(held.guard);
    host.send({ type: 'quitRequest' });
    const late = await windows.open(Note);
    late!.canClose(() => false);
    held.answer(true);
    await flush();
    assert.deepEqual(host.answers, [false]);
  });

  it('refuses a window opened while willQuit runs, so no guard it adds is skipped', async () => {
    const { host, windows, lifecycle } = start();
    await flush();
    let refused: unknown = null;
    lifecycle.willQuit(async () => {
      try {
        const late = await windows.open(Note);
        late?.canClose(() => false);
      } catch (error) {
        refused = error;
      }
    });
    host.send({ type: 'quitRequest' });
    await flush();
    await flush();
    assert.match(String(refused), /quitting/);
    assert.deepEqual(host.answers, [true]);
    assert.deepEqual(
      windows.windows().map((window) => window.key),
      ['main'],
    );
  });

  it('never approves a quit past a window whose host open finished after the last guard', async () => {
    // However many turns after the last guard's yes the host finishes an open, the window is
    // either asked (and its guard says no) or refused: never mounted unasked into an approved quit.
    for (let turns = 0; turns <= 20; turns++) {
      const { host, windows, mounter } = start();
      await flush();
      const held = heldGuard();
      windows.windows()[0]!.canClose(held.guard);
      // The late window says no as it mounts, as an app's own guard would.
      const mount = mounter.mounter.mount;
      mounter.mounter.mount = (surface, ...rest) => {
        const mounted = mount(surface, ...rest);
        if (surface === 99)
          windows
            .windows()
            .at(-1)!
            .canClose(() => false);
        return mounted;
      };
      let finishOpen!: (surface: number) => void;
      const open = host.native.open;
      host.native.open = () => new Promise<number>((resolve) => (finishOpen = resolve));
      const late = windows.open(Note).then(
        () => 'opened',
        () => 'refused',
      );
      await flush();
      host.native.open = open;
      host.send({ type: 'quitRequest' });
      await flush();
      held.answer(true);
      for (let turn = 0; turn < turns; turn++) await Promise.resolve();
      finishOpen(99);
      await flush();
      await flush();
      const approved = host.answers.includes(true);
      assert.ok(!(approved && (await late) === 'opened'), `after ${turns} turns`);
    }
  });

  it('still refuses a window opened after the quit was approved', async () => {
    const { host, windows } = start();
    await flush();
    host.send({ type: 'quitRequest' });
    await flush();
    await flush();
    assert.deepEqual(host.answers, [true]);
    await assert.rejects(windows.open(Note), /quitting/);
  });

  it('runs willQuit once when a SIGTERM arrives during a Cmd-Q, and answers once', async () => {
    const { host, windows, lifecycle } = start();
    await flush();
    let runs = 0;
    lifecycle.willQuit(() => void runs++);
    const held = heldGuard();
    windows.windows()[0]!.canClose(held.guard);
    host.send({ type: 'quitRequest' });
    host.send({ type: 'quitRequest', terminate: true });
    await flush();
    assert.equal(runs, 1);
    assert.deepEqual(host.answers, [true]);
    held.answer(true);
    await flush();
    assert.equal(runs, 1, 'the Cmd-Q, agreed late, does not run the handlers again');
    assert.deepEqual(host.answers, [true]);
  });

  it('asks again on a later Cmd-Q once a quit was refused', async () => {
    const { host, windows } = start();
    await flush();
    let allow = false;
    windows.windows()[0]!.canClose(() => allow);
    host.send({ type: 'quitRequest' });
    await flush();
    allow = true;
    host.send({ type: 'quitRequest' });
    await flush();
    assert.deepEqual(host.answers, [false, true]);
  });
});

describe('the main window on the platform mounter', () => {
  let fixtures: Record<string, Type<unknown>>;
  before(async () => {
    fixtures = (await compileFixture('fixtures/app-windows.ts')) as Record<string, Type<unknown>>;
  });

  function mountWindowed(root: string, options: Parameters<typeof mount>[3] = {}) {
    const host = fakeHost();
    const fabric = createFakeFabric();
    const app = mount(1, fixtures[root]!, fabric, {
      ...options,
      providers: [
        { provide: AppWindows.SOURCE, useValue: host.native },
        ...(options.providers ?? []),
      ],
    });
    return { host, fabric, app, windows: app.applicationRef.injector.get(AppWindows) };
  }

  it('destroys the root, and closes its window, when a bootstrap listener throws', async () => {
    const { host, app, windows } = mountWindowed('MainWindowApp', {
      providers: [
        provideMainWindow({ autoOpen: false }),
        {
          provide: APP_BOOTSTRAP_LISTENER,
          multi: true,
          useValue: () => {
            throw new Error('listener failed');
          },
        },
      ],
    });
    try {
      await assert.rejects(windows.openMain(), /listener failed/);
      assert.equal(app.applicationRef.components.length, 0, 'the root is no app component');
      assert.equal(app.applicationRef.viewCount, 0, 'nor a view change detection checks');
      assert.deepEqual(host.closed, [11]);
    } finally {
      app.applicationRef.destroy();
    }
  });

  it("keeps the app's safe-area insets out of a window, and gives it the app's other tokens", async () => {
    const { app, windows } = mountWindowed('NoteWindow');
    const appTokens = (top: number, accent: number) => ({
      '--safe-area-inset-top': { length: top },
      '--safe-area-inset-titlebar-leading': { length: 78 },
      '--accent-gap': { length: accent },
    });
    try {
      await settle();
      // What the main window's provider reported before the window opened, and after.
      app.engine.updateTokens(appTokens(52, 4));
      await windows.open(fixtures['ScreenWindow']!);
      const made = (fixtures['ScreenWindow'] as unknown as { made: { engine: Engine }[] }).made;
      const engine = made.at(-1)!.engine;
      const seen = () => [
        engine.token('--safe-area-inset-top'),
        engine.token('--safe-area-inset-titlebar-leading'),
        engine.token('--accent-gap'),
      ];
      assert.deepEqual(seen(), [undefined, undefined, '4px'], 'what the window starts with');
      app.engine.updateTokens(appTokens(28, 8));
      assert.deepEqual(seen(), [undefined, undefined, '8px'], 'what the window follows');
    } finally {
      app.applicationRef.destroy();
    }
  });

  it('gives the main window the bindings mount was given', async () => {
    const { fabric, app } = mountWindowed('NoteWindow', {
      bindings: [inputBinding('name', () => 'Groceries')],
    });
    try {
      await settle();
      const text = (node: FakeFabricNode): string =>
        node.viewName === 'RawText'
          ? String(node.props['text'] ?? '')
          : node.children.map(text).join('');
      assert.equal(fabric.committed.map(text).join('').trim(), 'Groceries 0');
    } finally {
      app.applicationRef.destroy();
    }
  });
});

describe('a size the host sends before the window is mounted', () => {
  // iPadOS sends a reclaimed window's size straight after answering `open`, before the app has
  // mounted anything on the surface.
  it('reaches the mount once it is made', async () => {
    const { mounter, windows } = start({
      opening: (surface, send) => send({ type: 'resize', surface, width: 700, height: 500 }),
    });
    await flush();
    const note = await windows.open(Note);
    assert.ok(note);
    assert.ok(mounter.sizes.includes(`${note.surface} 700x500`), mounter.sizes.join(', '));
  });

  it('is forgotten when the surface closes before a window is made on it', async () => {
    let early: number | null = null;
    const { host, mounter, windows } = start({
      opening: (surface, send) => {
        if (early !== null) return;
        early = surface + 10;
        // A size for a surface the app has not opened, then its close.
        send({ type: 'resize', surface: early, width: 300, height: 200 });
        send({ type: 'closed', surface: early });
      },
    });
    await flush();
    const note = await windows.open(Note);
    assert.equal(note?.surface, early, 'the surface the size named');
    assert.deepEqual(
      mounter.sizes.filter((size) => size.endsWith('300x200')),
      [],
      'the closed surface left no size behind',
    );
    assert.equal(host.closed.length, 0);
  });
});
