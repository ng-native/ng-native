/**
 * Android's back button, and `NativeNavigation.back()`, in an app with tabs whose tabs have
 * stacks of their own: the real `Router` over the real outlets.
 *
 * Every stack answers the button, and React Native asks the newest handler first, so a stack in
 * a tab behind the one in front, or under a screen pushed over the whole bar, could answer a
 * press meant for another. And going back one history entry is not a pop once a trip to another
 * tab sits in history between a screen and the one below it.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { NavigationEnd, Router, type Routes } from '@angular/router';
import { HardwareBack } from '@ng-native/device';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

describe('going back in an app with tabs', () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let navigation: NativeNavigation;
  /** Every handler the app gave the button, oldest first, as React Native holds them. */
  let handlers: (() => boolean)[];

  /** Press the button: the newest handler first, and the platform's own default if none takes it. */
  const pressBack = async (): Promise<boolean> => {
    const taken = [...handlers].reverse().some((handler) => handler());
    await settle();
    return taken;
  };

  const go = async (url: string) => {
    await router.navigateByUrl(url);
    await settle();
  };

  before(async () => {
    mod = await compileFixture(fileURLToPath(new URL('./fixtures/tab-stacks.ts', import.meta.url)));
  });

  beforeEach(async () => {
    handlers = [];
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['routes'] as Routes),
        {
          provide: HardwareBack.SOURCE,
          useValue: {
            subscribe: (handler: () => boolean) => {
              handlers.push(handler);
              return () => handlers.splice(handlers.indexOf(handler), 1);
            },
          },
        },
      ],
    });
    router = app.componentRef.injector.get(Router);
    navigation = app.componentRef.injector.get(NativeNavigation);
    await settle();
    assert.equal(router.url, '/home');
  });

  afterEach(() => cleanup());

  it("puts a tab's first screen under a page pushed into a tab not opened yet", async () => {
    assert.equal(await navigation.push('/library/7'), true);
    await settle();
    assert.equal(router.url, '/library/7');
    assert.ok(screen.getByText('album'));
    assert.ok(screen.getByText('library'), 'the list is mounted under it');

    navigation.back();
    await settle();
    await settle();
    assert.equal(router.url, '/library', 'and a back pops to it, not to the tab it came from');
  });

  it('pushes the same way from an array of commands, and with a query', async () => {
    assert.equal(await navigation.push(['/search', 'cats'], { queryParams: { page: 2 } }), true);
    await settle();
    assert.equal(router.url, '/search/cats?page=2');
    navigation.back();
    await settle();
    await settle();
    assert.equal(router.url, '/search');
  });

  it('pushes straight onto a tab that has been opened, in one navigation', async () => {
    await go('/library');
    await go('/home');
    let ended = 0;
    const events = router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) ended++;
    });
    await navigation.push('/library/7');
    await settle();
    events.unsubscribe();
    assert.equal(ended, 1);
    assert.equal(router.url, '/library/7');
  });

  it('pops the stack in front after a trip to another tab, rather than going back to that tab', async () => {
    await go('/library');
    await go('/library/7');
    await go('/search');
    await go('/library/7');

    assert.equal(await pressBack(), true);
    assert.equal(router.url, '/library', 'the album popped, not back to the search tab');
  });

  it('pops the same way from NativeNavigation.back()', async () => {
    await go('/library');
    await go('/library/7');
    await go('/search');
    await go('/library/7');

    navigation.back();
    await settle();

    assert.equal(router.url, '/library');
  });

  it('pops a tab s stack to the tab s first screen, after a trip to another tab', async () => {
    await go('/library');
    await go('/library/7');
    await go('/search');
    await go('/library/7');
    assert.equal(await navigation.popToRoot(), true);
    await settle();
    assert.equal(router.url, '/library', 'the tab s own root, not the app s first tab');
  });

  it('pops to a screen in the tab in front, and not in a tab behind', async () => {
    await go('/library');
    await go('/library/7');
    await go('/search');
    await go('/search/cats');
    assert.equal(await navigation.popTo('/library'), false, 'the library is not in front');
    assert.equal(await navigation.popTo('/search'), true);
    await settle();
    assert.equal(router.url, '/search');
  });

  it('leaves a stack in a tab behind alone', async () => {
    // The search tab's stack is the newest handler and has nothing to pop; the library's, behind
    // it, has an album on top that is not what the user is looking at.
    await go('/library');
    await go('/library/7');
    await go('/search');

    assert.equal(await pressBack(), true);
    assert.equal(router.url, '/home', 'to the first tab, not into the library behind');
  });

  it("leaves a tab's stack alone while a screen is pushed over the whole bar", async () => {
    await go('/library');
    await go('/library/7');
    await go('/home');
    await go('/detail/1');

    assert.equal(await pressBack(), true);
    assert.equal(router.url, '/home', 'the detail popped off the app stack');
  });

  it('leaves the tab bar alone while a screen is pushed over it', async () => {
    await go('/search');
    await go('/detail/1');

    assert.equal(await pressBack(), true);
    assert.equal(router.url, '/search', 'back to the tab the detail was opened from');
  });

  it("goes to the first tab from another tab's root, whatever was visited in between", async () => {
    await go('/search');
    await go('/library');

    assert.equal(await pressBack(), true);
    assert.equal(router.url, '/home');
  });

  it('declines on the first tab, so the platform leaves the app', async () => {
    await go('/search');
    await go('/home');

    assert.equal(await pressBack(), false, 'nothing in the app takes it');
    assert.equal(router.url, '/home');
  });
});
