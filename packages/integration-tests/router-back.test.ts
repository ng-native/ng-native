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
import type { Type } from '@angular/core';
import { NavigationEnd, Router, type Routes } from '@angular/router';
import { HardwareBack } from '@ng-native/device';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

describe('going back in an app with tabs', () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let navigation: NativeNavigation;
  let fabric: FakeFabric;
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
    mod = await compileFixture('fixtures/tab-stacks.ts');
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
    fabric = app.fabric;
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
    const stacks = (nodes: readonly FakeFabricNode[]): number =>
      nodes.reduce(
        (count, node) =>
          count + (node.viewName === 'RNSScreenStack' ? 1 : 0) + stacks(node.children),
        0,
      );
    assert.equal(stacks(fabric.committed), 2, "the app's stack and the tab's, not a second one");
  });

  describe('presenting a page of another tab', () => {
    /** The screens of the app's own stack, as native has them: the bar, then what is over it. */
    const rootScreens = () => {
      const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
        nodes.flatMap((node) => [node, ...all(node.children)]);
      const stack = all(fabric.committed).find((node) => node.viewName === 'RNSScreenStack')!;
      return stack.children.filter((node) => node.viewName === 'RNSScreen');
    };

    it('shows it over the tab that asked, and leaves its own tab unopened', async () => {
      assert.equal(await navigation.present('/library/7', { as: 'modal' }), true);
      await settle();

      assert.ok(screen.getByText('album'), 'the page is shown');
      assert.equal(screen.queryByText('library'), null, 'in no stack of the library tab');
      assert.equal(router.url, '/home(presented:library/7)', 'and the tab in front is still home');
      const screens = rootScreens();
      assert.equal(screens.length, 2, 'on the app s own stack, over the bar');
      assert.equal(screens[1]!.props['stackPresentation'], 'modal');
    });

    it('gives the page its params, and goes back to the tab it was presented over', async () => {
      await navigation.present('/search/cats', { as: 'formSheet' });
      await settle();
      assert.equal(rootScreens()[1]!.props['stackPresentation'], 'formSheet');
      const route = router.routerState.root.children.find((child) => child.outlet === 'presented');
      assert.deepEqual(route?.snapshot.params, { q: 'cats' });

      navigation.back();
      await settle();
      await settle();
      assert.equal(router.url, '/home');
      assert.equal(screen.queryByText('result'), null);
      assert.equal(rootScreens().length, 1);
    });

    it('presents a lazily loaded page the same way, the first time as every other', async () => {
      for (const time of ['first', 'second']) {
        assert.equal(await navigation.present('/search/saved/cats', { as: 'modal' }), true, time);
        await settle();
        assert.equal(router.url, '/home(presented:search/saved/cats)', time);
        assert.ok(screen.getByText('result'), time);
        assert.equal(rootScreens().length, 2, time);

        navigation.back();
        await settle();
        await settle();
        assert.equal(router.url, '/home', time);
        assert.equal(rootScreens().length, 1, time);
      }
    });

    it('is dismissed by the swipe that dismisses a sheet', async () => {
      await navigation.present('/library/7', { as: 'modal' });
      await settle();
      await fireEvent(rootScreens()[1]!, 'dismissed', { dismissCount: 1 });
      await settle();
      assert.equal(router.url, '/home');
      assert.equal(rootScreens().length, 1);
    });

    it('is left behind by a push from it, which goes to its url s own tab', async () => {
      await go('/library');
      await go('/home');
      await navigation.present('/search/cats', { as: 'modal' });
      await settle();
      await navigation.push('/library/7');
      await settle();
      assert.equal(router.url, '/library/7');
      assert.equal(screen.queryByText('result'), null, 'the page is dismissed');
      assert.equal(rootScreens().length, 1);
    });

    it('is left behind by a link relative to it, which goes where the link leads', async () => {
      await navigation.present('/library/7', { as: 'modal' });
      await settle();
      const page = router.routerState.root.children.find((child) => child.outlet === 'presented');
      assert.equal(await navigation.push(['..', '9'], { relativeTo: page }), true);
      await settle();
      assert.equal(router.url, '/library/9');
      assert.equal(rootScreens().length, 1);
    });

    it('is replaced by the next page presented', async () => {
      await navigation.present('/search/cats', { as: 'modal' });
      await settle();
      await navigation.present('/library/7', { as: 'modal' });
      await settle();
      assert.equal(router.url, '/home(presented:library/7)');
      assert.equal(rootScreens().length, 2);

      navigation.back();
      await settle();
      await settle();
      assert.equal(router.url, '/home');
      assert.equal(rootScreens().length, 1);
    });

    it('still presents a page of the tab in front, or of no tab, where its url puts it', async () => {
      await go('/library');
      await navigation.present('/library/7', { as: 'modal' });
      await settle();
      assert.equal(router.url, '/library/7');

      await navigation.present('/detail/1', { as: 'modal' });
      await settle();
      assert.equal(router.url, '/detail/1');
    });
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
