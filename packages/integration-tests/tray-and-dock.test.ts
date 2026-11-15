/**
 * `<tray-icon>` and the `Dock` service, on a fake host.
 *
 * The host contracts:
 * - `NgNativeTray`: `setIcons(icons)` takes every icon each time one changes, as
 *   `{ id, title, sfSymbol, image, tooltip, menu }`, `menu` as `serializeMenu` makes it or null for
 *   an icon whose click is a press. Events on `ngNativeTray`: `{ type: 'press', icon }` and
 *   `{ type: 'menuSelect', icon, id }`.
 * - `NgNativeDock`: `setMenu(entries | null)`, `bounce(critical)` answering an id, and
 *   `cancelBounce(id)`. Events on `ngNativeDock`: `{ type: 'menuSelect', id }`. The Dock badge is
 *   the Notifications badge count, which the desktop host's Notifications source draws.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import {
  Dock,
  Tray,
  type NativeDock,
  type NativeTray,
  type NativeTrayEvent,
  type NativeTrayIcon,
} from '@ng-native/device';
import { cleanup, injectService, render, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type Fixture = { shown: WritableSignal<boolean>; time: WritableSignal<string>; said: string[] };
let Fixture: Type<Fixture>;
before(async () => {
  Fixture = (await compileFixture('fixtures/tray-icon.ts'))['TrayIconFixture'] as Type<Fixture>;
});
afterEach(cleanup);

function fakeTray() {
  const sets: NativeTrayIcon[][] = [];
  const listeners = new Set<(event: NativeTrayEvent) => void>();
  const native: NativeTray = {
    setIcons: (icons) => void sets.push([...icons]),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const send = async (event: NativeTrayEvent) => {
    listeners.forEach((listener) => listener(event));
    await settle();
  };
  return { native, icons: () => sets.at(-1)!, send };
}

describe('a tray icon', () => {
  it('sends each icon with its menu, or as a press, and follows its bindings', async () => {
    const tray = fakeTray();
    const app = await render(Fixture, {
      providers: [{ provide: Tray.SOURCE, useValue: tray.native }],
    });
    await settle();
    const timer = tray.icons().find((icon) => icon.sfSymbol === 'timer');
    const sync = tray.icons().find((icon) => icon.image === 'sync');
    assert.deepEqual(timer, {
      id: timer!.id,
      title: '25:00',
      sfSymbol: 'timer',
      tooltip: 'Focus timer',
      menu: [{ id: '0', label: 'Pause' }],
    });
    assert.deepEqual(sync, { id: sync!.id, image: 'sync', menu: null });
    app.instance.time.set('24:59');
    await app.detectChanges();
    assert.equal(tray.icons().find((icon) => icon.sfSymbol)!.title, '24:59');
    await tray.send({ type: 'menuSelect', icon: timer!.id, id: '0' });
    await tray.send({ type: 'press', icon: sync!.id });
    assert.deepEqual(app.instance.said, ['pause', 'sync']);
  });

  it('takes an icon away as its element goes', async () => {
    const tray = fakeTray();
    const app = await render(Fixture, {
      providers: [{ provide: Tray.SOURCE, useValue: tray.native }],
    });
    await settle();
    app.instance.shown.set(false);
    await app.detectChanges();
    assert.deepEqual(
      tray.icons().map((icon) => icon.image),
      ['sync'],
    );
  });

  it('is absent with no host module, and draws nothing', async () => {
    const tray = injectService(Tray, { providers: [{ provide: Tray.SOURCE, useValue: null }] });
    assert.equal(tray.available(), false);
  });
});

describe('the Dock', () => {
  function fakeDock() {
    const menus: unknown[] = [];
    const cancelled: number[] = [];
    const bounces: boolean[] = [];
    let listener: ((event: { type: 'menuSelect'; id: string }) => void) | null = null;
    const native: NativeDock = {
      setMenu: (entries) => void menus.push(entries),
      bounce: (critical) => bounces.push(critical),
      cancelBounce: (id) => void cancelled.push(id),
      subscribe: (fn) => {
        listener = fn;
        return () => (listener = null);
      },
    };
    return {
      native,
      menus,
      cancelled,
      bounces,
      select: (id: string) => listener?.({ type: 'menuSelect', id }),
    };
  }

  it('sets its menu, runs the item chosen, and takes the menu away', () => {
    const host = fakeDock();
    const dock = injectService(Dock, {
      providers: [{ provide: Dock.SOURCE, useValue: host.native }],
    });
    const said: string[] = [];
    dock.setMenu([{ label: 'New Window', shortcut: 'mod+n', select: () => said.push('new') }]);
    assert.deepEqual(host.menus.at(-1), [
      {
        id: '0',
        label: 'New Window',
        shortcut: { key: 'n', meta: true, ctrl: false, alt: false, shift: false },
      },
    ]);
    host.select('0');
    assert.deepEqual(said, ['new']);
    dock.setMenu(null);
    assert.equal(host.menus.at(-1), null);
    host.select('0');
    assert.deepEqual(said, ['new'], 'a menu taken away runs nothing');
  });

  it('bounces, critically when asked, and stops a bounce', () => {
    const host = fakeDock();
    const dock = injectService(Dock, {
      providers: [{ provide: Dock.SOURCE, useValue: host.native }],
    });
    dock.bounce();
    const stop = dock.bounce({ critical: true });
    stop();
    assert.deepEqual(host.bounces, [false, true]);
    assert.deepEqual(host.cancelled, [2]);
  });

  it('does nothing where there is no Dock', () => {
    const dock = injectService(Dock, { providers: [{ provide: Dock.SOURCE, useValue: null }] });
    assert.equal(dock.available(), false);
    dock.setMenu([{ label: 'Nothing' }]);
    dock.bounce()();
  });
});
