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
import { AppWindows, Menus, type NativeMenuEvent, type NativeMenus } from '@ng-native/device';
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
  const native: NativeMenus = {
    menuBar: true,
    appName: 'Notes',
    setMenuBar: () => {},
    setShortcuts: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return { native, send: (event: NativeMenuEvent) => listeners.forEach((one) => one(event)) };
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
        { path: 'settings', component: page },
        { path: 'general', outlet: 'preferences', component: fixtures['GeneralPage']! },
        { path: 'privacy', outlet: 'preferences', component: fixtures['GeneralPage']! },
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
