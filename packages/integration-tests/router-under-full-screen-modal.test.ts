/**
 * On iOS a screen a tab's stack presents `fullScreenModal` takes the app's own stack out of the
 * window, and react-native-screens' stack changes nothing while it is out of it. A screen pushed or
 * presented on the app's stack then never appears, though the url says it is there, and the next
 * back takes off the screen nobody saw. So such a navigation is refused: it resolves false, and the
 * url and the screens stay as they were.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { Location } from '@angular/common';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import type { StackPresentation } from '../router/src/screen-presentation.ts';
import { compileFixture } from './compile.ts';
import type { LivePage } from './fixtures/router-fuzz.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/router-fuzz.ts');
});

const turns = async () => {
  for (let turn = 0; turn < 6; turn++) await settle();
};

/**
 * The fixture's routes, and two more: a page that is a stack of its own, a screen per id, and a
 * page inside a route with no component.
 */
function routes(): Routes {
  return [
    ...(mod['routes'] as Routes),
    {
      path: 'deck/:id',
      component: mod['TabStack'] as Type<unknown>,
      children: [
        { path: '', component: mod['Library'] as Type<unknown> },
        { path: 'card/:id', component: mod['Album'] as Type<unknown> },
      ],
    },
    {
      path: 'group',
      children: [{ path: 'detail/:id', component: mod['Detail'] as Type<unknown> }],
    },
  ];
}

/**
 * The app on the Library tab, with `/library/3` presented over it by the tab's own stack. With
 * `under`, the app's stack has that screen under the tab bar.
 */
async function overTheTab(as: StackPresentation = 'fullScreenModal', ...under: string[]) {
  (mod['live'] as Set<LivePage>).clear();
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [provideNativeRouter(routes())],
  });
  await settle();
  const router = app.componentRef.injector.get(Router);
  const nav = app.componentRef.injector.get(NativeNavigation);
  const live = mod['live'] as Set<LivePage>;
  if (under.length) {
    await nav.reset(under[0]!);
    for (const url of [...under.slice(1), '/library']) {
      await turns();
      await nav.push(url);
    }
  } else await router.navigateByUrl('/library');
  await turns();
  assert.equal(await nav.present('/library/3', { as }), true);
  await turns();
  assert.equal(router.url, '/library/3');
  return {
    router,
    nav,
    location: app.componentRef.injector.get(Location),
    front: () => [...live].filter((page) => page.inFront()).map((page) => page.name()),
    live: () => [...live].map((page) => page.name()).sort(),
  };
}

type App = Awaited<ReturnType<typeof overTheTab>>;

describe('a screen for the app stack while a tab stack presents one full screen', () => {
  for (const [how, go] of [
    ['present()', (app: App) => app.nav.present('/detail/1', { as: 'pageSheet' })],
    ['push()', (app: App) => app.nav.push('/detail/1')],
    ['the router', (app: App) => app.router.navigateByUrl('/detail/1')],
    ['present() of a page of another tab', (app: App) => app.nav.present('/home')],
  ] as const) {
    it(`is refused through ${how}, and one back dismisses the modal`, async () => {
      const app = await overTheTab();
      assert.equal(await go(app), false);
      await turns();
      assert.equal(app.router.url, '/library/3', 'the url is unchanged');
      assert.deepEqual(app.front(), ['library/3']);
      assert.deepEqual(app.live(), ['home', 'library', 'library/3'], 'no screen was made');

      app.nav.back();
      await turns();
      assert.equal(app.router.url, '/library');
      assert.deepEqual(app.front(), ['library']);
    });
  }

  it('goes ahead once the modal is dismissed', async () => {
    const app = await overTheTab();
    assert.equal(await app.nav.present('/detail/1', { as: 'pageSheet' }), false);
    app.nav.back();
    await turns();

    assert.equal(await app.nav.present('/detail/1', { as: 'pageSheet' }), true);
    await turns();
    assert.equal(app.router.url, '/detail/1');
    assert.deepEqual(app.front(), ['detail/1']);
  });

  it('control: goes ahead over a tab stack presenting a sheet, which leaves the app stack shown', async () => {
    const app = await overTheTab('pageSheet');
    assert.equal(await app.nav.present('/detail/1', { as: 'pageSheet' }), true);
    await turns();
    assert.equal(app.router.url, '/detail/1');
    assert.deepEqual(app.front(), ['detail/1']);
  });

  it('control: goes ahead on the stack presenting the modal', async () => {
    const app = await overTheTab();
    assert.equal(await app.nav.push('/library/4'), true);
    await turns();
    assert.equal(app.router.url, '/library/4');
    assert.deepEqual(app.front(), ['library/4']);
  });

  it('control: goes ahead to another tab, which dismisses the modal', async () => {
    const app = await overTheTab();
    assert.equal(await app.nav.push('/home'), true);
    await turns();
    assert.equal(app.router.url, '/home');
    assert.deepEqual(app.front(), ['home']);
  });

  it('control: goes ahead back to a screen the app stack holds, which takes the modal off', async () => {
    const app = await overTheTab('fullScreenModal', '/detail/1');
    assert.equal(await app.router.navigateByUrl('/detail/1'), true);
    await turns();
    assert.equal(app.router.url, '/detail/1');
    assert.deepEqual(app.front(), ['detail/1']);
    assert.deepEqual(app.live(), ['detail/1'], 'the tab bar and the modal are gone');
  });

  it('control: goes ahead back to a screen inside a route with no component', async () => {
    const app = await overTheTab('fullScreenModal', '/group/detail/1');
    assert.equal(await app.router.navigateByUrl('/group/detail/1'), true);
    await turns();
    assert.equal(app.router.url, '/group/detail/1');
    assert.deepEqual(app.live(), ['detail/1']);
  });

  it('control: goes ahead back through history to a screen the app stack holds', async () => {
    const app = await overTheTab('fullScreenModal', '/detail/2', '/detail/1');
    app.location.historyGo(-2);
    await turns();
    assert.equal(app.router.url, '/detail/1');
    assert.deepEqual(app.front(), ['detail/1']);
    assert.deepEqual(app.live(), ['detail/1', 'detail/2']);
  });

  it('is refused for another screen of the route showing the modal', async () => {
    const app = await overTheTab();
    await app.nav.reset('/deck/1');
    await turns();
    assert.equal(await app.nav.present('/deck/1/card/7', { as: 'fullScreenModal' }), true);
    await turns();
    assert.equal(await app.nav.push('/deck/2'), false);
    assert.equal(app.router.url, '/deck/1/card/7');
  });

  it('control: goes ahead inside a screen the app stack presents full screen', async () => {
    const app = await overTheTab();
    await app.nav.reset('/detail/1');
    await turns();
    assert.equal(await app.nav.present('/library', { as: 'fullScreenModal' }), true);
    await turns();
    assert.equal(await app.nav.push('/library/4'), true);
    await turns();
    assert.equal(app.router.url, '/library/4');
    assert.deepEqual(app.front(), ['library/4']);
  });

  it('control: goes ahead with a reset, which takes the modal off with the tab bar', async () => {
    const app = await overTheTab();
    assert.equal(await app.nav.reset('/detail/1'), true);
    await turns();
    assert.equal(app.router.url, '/detail/1');
    assert.deepEqual(app.live(), ['detail/1']);
  });

  it('control: goes ahead on Android', async () => {
    registerPlatformComponents('android');
    try {
      const app = await overTheTab();
      assert.equal(await app.nav.present('/detail/1', { as: 'pageSheet' }), true);
      await turns();
      assert.equal(app.router.url, '/detail/1');
      assert.deepEqual(app.front(), ['detail/1']);
    } finally {
      registerPlatformComponents('ios');
    }
  });
});
