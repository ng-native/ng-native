/**
 * Back and forward history per window, in `@ng-native/router`: one list per window spanning every
 * change of its outlet, a new navigation clearing the entries ahead, and forward building its page
 * again from the URL. The OS's back and forward inputs reach it as `navigate` events from the
 * `NgNativeMenus` module, with the window they were in.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router } from '@angular/router';
import {
  AppWindows,
  Menus,
  type NativeMenuEvent,
  type NativeMenus,
  type NativeWindowHistory,
  type NativeWindows,
} from '@ng-native/device';
import { mount, type MountResult } from '@ng-native/platform';
import { NativeNavigation, NavigationHistory, provideNativeRouter } from '@ng-native/router';
import { createFakeFabric, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

let fixtures: Record<string, Type<unknown>>;
before(async () => {
  fixtures = (await compileFixture('fixtures/app-windows.ts')) as Record<string, Type<unknown>>;
});

let apps: MountResult[] = [];
afterEach(() => {
  for (const app of apps) app.applicationRef.destroy();
  apps = [];
});

const idle = async () => {
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settle();
};

function menusHost() {
  const listeners = new Set<(event: NativeMenuEvent) => void>();
  const histories: [number, NativeWindowHistory][] = [];
  const native: NativeMenus = {
    menuBar: true,
    appName: 'Notes',
    setMenuBar: () => {},
    setShortcuts: () => {},
    setHistory: (surface, history) => void histories.push([surface, history]),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return {
    native,
    histories,
    send: (event: NativeMenuEvent) => listeners.forEach((one) => one(event)),
  };
}

/** A host that opens a surface a window, 11 first. */
function windowsHost(): NativeWindows {
  let next = 11;
  return {
    open: async () => (next += 10) - 10,
    close: () => {},
    focus: () => {},
    setTitle: () => {},
    quit: () => {},
    answerQuit: () => {},
    subscribe: () => () => {},
  };
}

async function start(windows: unknown = null) {
  const menus = menusHost();
  const page = fixtures['HomePage']!;
  const app = mount(1, fixtures['RoutedApp']!, createFakeFabric(), {
    providers: [
      provideNativeRouter([
        { path: '', component: page },
        { path: 'notes', component: page },
        { path: 'notes/:id', component: page },
        { path: 'settings', component: page, title: 'Settings' },
        { path: 'general', outlet: 'preferences', component: fixtures['GeneralPage']! },
        {
          path: 'privacy',
          outlet: 'preferences',
          component: fixtures['GeneralPage']!,
          title: 'Privacy',
        },
      ]),
      { provide: Menus.SOURCE, useValue: menus.native },
      { provide: AppWindows.SOURCE, useValue: windows },
    ],
  });
  apps.push(app);
  await idle();
  const injector = app.applicationRef.injector;
  return {
    menus,
    router: injector.get(Router),
    navigation: injector.get(NativeNavigation),
    history: injector.get(NavigationHistory),
    windows: injector.get(AppWindows),
  };
}

describe('a window history', () => {
  it('goes back and forward through what was pushed, and clears what is ahead on a push', async () => {
    const { router, navigation, history } = await start();
    const main = history.for();
    await navigation.push('/notes');
    await navigation.push('/notes/1');
    await idle();
    assert.deepEqual(main.entries(), ['/', '/notes', '/notes/1']);
    assert.equal(await main.back(), true);
    await idle();
    assert.equal(router.url, '/notes');
    assert.equal(main.canGoForward(), true);
    assert.deepEqual(
      main.forwardMenu().map((item) => item.label),
      ['/notes/1'],
    );
    assert.equal(await main.forward(), true, 'forward builds the page again from its URL');
    await idle();
    assert.equal(router.url, '/notes/1');
    assert.equal(main.canGoForward(), false);
    await main.back();
    await idle();
    // A sidebar item, or any other navigation: the entries ahead go.
    await navigation.push('/settings');
    await idle();
    assert.deepEqual(main.entries(), ['/', '/notes', '/settings']);
    assert.equal(main.canGoForward(), false);
    assert.deepEqual(
      main.backMenu().map((item) => item.label),
      ['/notes', '/'],
    );
    // An entry is listed by its route's title where it has one.
    await main.back();
    await idle();
    assert.deepEqual(
      main.forwardMenu().map((item) => item.label),
      ['Settings'],
    );
  });

  it('goes as many entries as a pick from a chevron menu says, and no further than the ends', async () => {
    const { router, navigation, history, menus } = await start();
    await navigation.push('/notes');
    await navigation.push('/notes/1');
    await navigation.push('/settings');
    await idle();
    menus.send({ type: 'navigate', direction: 'back', steps: 2 });
    await idle();
    assert.equal(router.url, '/notes');
    assert.equal(history.for().index(), 1);
    menus.send({ type: 'navigate', direction: 'forward', steps: 5 });
    await idle();
    assert.equal(router.url, '/settings', 'past the end stops at the last entry');
    menus.send({ type: 'navigate', direction: 'back', steps: 9 });
    await idle();
    assert.equal(router.url, '/');
  });

  it("tells the host each window's history by title, nearest first, as it changes", async () => {
    const { router, menus, windows } = await start(windowsHost());
    const window = await windows.open({ outlet: 'preferences', path: 'general' });
    const surface = window!.surface;
    await idle();
    await router.navigate([{ outlets: { preferences: ['privacy'] } }]);
    await idle();
    const last = () => menus.histories.filter(([one]) => one === surface).at(-1)?.[1];
    assert.deepEqual(last(), { back: ['/general'], forward: [] });
    menus.send({ type: 'navigate', direction: 'back', surface });
    await idle();
    assert.deepEqual(last(), { back: [], forward: ['Privacy'] });
  });

  it("clears a window's chevrons when its outlet shows nothing and its history goes", async () => {
    const { router, menus, windows } = await start(windowsHost());
    const window = await windows.open({ outlet: 'preferences', path: 'general' });
    const surface = window!.surface;
    await idle();
    await router.navigate([{ outlets: { preferences: ['privacy'] } }]);
    await idle();
    const last = () => menus.histories.filter(([one]) => one === surface).at(-1)?.[1];
    assert.deepEqual(last(), { back: ['/general'], forward: [] });
    await router.navigate([{ outlets: { preferences: null } }]);
    await idle();
    assert.ok(
      windows.windows().some((one) => one.surface === surface),
      'the window stays open',
    );
    assert.deepEqual(last(), { back: [], forward: [] });
  });

  it('keeps the last 100 entries of a window, dropping the oldest, so a long session does not grow it', async () => {
    const { navigation, history } = await start();
    const main = history.for();
    for (let id = 1; id <= 120; id++) await navigation.push(`/notes/${id}`);
    await idle();
    const entries = main.entries();
    assert.equal(entries.length, 100);
    assert.equal(entries[0], '/notes/21');
    assert.equal(entries.at(-1), '/notes/120');
    assert.equal(main.index(), 99);
    assert.equal(main.canGoBack(), true);
    assert.equal(await main.back(), true);
    await idle();
    assert.equal(main.index(), 98);
    assert.equal(main.entries()[98], '/notes/119');
  });

  it('goes back from the OS command, and does nothing at the start', async () => {
    const { router, navigation, history, menus } = await start();
    menus.send({ type: 'navigate', direction: 'back' });
    await idle();
    assert.equal(router.url, '/');
    await navigation.push('/notes');
    await idle();
    menus.send({ type: 'navigate', direction: 'back' });
    await idle();
    assert.equal(router.url, '/');
    menus.send({ type: 'navigate', direction: 'forward' });
    await idle();
    assert.equal(router.url, '/notes');
    assert.equal(history.for().index(), 1);
  });

  it('leaves a screen with gestureEnabled: false to its own way out, from the OS command', async () => {
    const { router, navigation, history, menus } = await start();
    await navigation.push('/notes', { presentation: { gestureEnabled: false } });
    await navigation.push('/settings');
    await idle();
    assert.equal(await history.for().back(), true, 'the app can still go back');
    await idle();
    assert.equal(router.url, '/notes');
    menus.send({ type: 'navigate', direction: 'forward' });
    await idle();
    assert.equal(router.url, '/notes', 'the swipe, the key and the mouse button are refused');
    menus.send({ type: 'navigate', direction: 'back' });
    await idle();
    assert.equal(router.url, '/notes');
    assert.equal(await history.for().back(), true);
    await idle();
    assert.equal(router.url, '/');
    menus.send({ type: 'navigate', direction: 'forward' });
    await idle();
    assert.equal(router.url, '/notes', 'forward from a screen that allows it');
  });

  it('goes back to an entry with its matrix params, and keeps the other windows', async () => {
    const { router, history } = await start();
    await router.navigateByUrl('/notes;sort=title(preferences:general)');
    await router.navigateByUrl('/settings(preferences:general)');
    await idle();
    const main = history.for();
    assert.deepEqual(main.entries(), ['/', '/notes;sort=title', '/settings']);
    assert.equal(await main.back(), true);
    await idle();
    assert.equal(router.url, '/notes;sort=title(preferences:general)');
    assert.equal(main.index(), 1, 'the entry gone back to, not a new one');
    assert.deepEqual(main.entries(), ['/', '/notes;sort=title', '/settings']);
  });

  it('forgets a back that failed, so a later navigation to that entry is a new one', async () => {
    const { router, navigation, history } = await start();
    const main = history.for();
    await navigation.push('/notes');
    await navigation.push('/settings');
    await idle();
    const navigateByUrl = router.navigateByUrl.bind(router);
    router.navigateByUrl = () => Promise.reject(new Error('navigation failed'));
    try {
      await assert.rejects(main.back(), /navigation failed/);
    } finally {
      router.navigateByUrl = navigateByUrl;
    }
    await router.navigateByUrl('/notes');
    await idle();
    assert.deepEqual(main.entries(), ['/', '/notes', '/settings', '/notes']);
    assert.equal(main.canGoForward(), false);
  });

  it('keeps a later back waiting when an earlier one is refused', async () => {
    const { router, navigation, history } = await start();
    const main = history.for();
    await navigation.push('/notes');
    await navigation.push('/settings');
    await idle();
    const navigateByUrl = router.navigateByUrl.bind(router);
    let refuse!: (done: boolean) => void;
    router.navigateByUrl = () => new Promise<boolean>((resolve) => (refuse = resolve));
    const first = main.go(0);
    router.navigateByUrl = navigateByUrl;
    const second = main.back();
    refuse(false);
    assert.equal(await first, false);
    assert.equal(await second, true);
    await idle();
    assert.equal(router.url, '/notes');
    assert.equal(main.index(), 1);
    assert.deepEqual(main.entries(), ['/', '/notes', '/settings']);
  });

  it('keeps a route window history apart, and drops it as the window closes', async () => {
    const { router, history } = await start();
    await router.navigate([{ outlets: { preferences: ['general'] } }]);
    await router.navigate([{ outlets: { preferences: ['privacy'] } }]);
    await idle();
    const preferences = history.for('preferences');
    assert.deepEqual(preferences.entries(), ['/general', '/privacy']);
    assert.deepEqual(history.for().entries(), ['/'], 'the main window did not move');
    await preferences.back();
    await idle();
    assert.equal(router.url, '/(preferences:general)');
    await router.navigate([{ outlets: { preferences: null } }]);
    await idle();
    assert.deepEqual(
      history.for('preferences').entries(),
      [],
      'a window opened again starts afresh',
    );
  });
});
