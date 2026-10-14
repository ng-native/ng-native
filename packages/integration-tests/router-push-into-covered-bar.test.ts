/**
 * A push to a page of the tab bar from a screen stacked over the bar, on the app's own stack or
 * presented over it, goes back to the bar: one tab bar, as a native app has. A second bar built
 * over the screen took the first one's pages for its own, and going back left a blank tab.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';
import type { LivePage } from './fixtures/router-fuzz.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/router-fuzz.ts');
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const turns = async () => {
  for (let turn = 0; turn < 6; turn++) await settle();
};

async function boot() {
  (mod['live'] as Set<LivePage>).clear();
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['routes'] as Routes)],
  });
  await settle();
  const router = app.componentRef.injector.get(Router);
  const nav = app.componentRef.injector.get(NativeNavigation);
  const live = mod['live'] as Set<LivePage>;
  return {
    router,
    nav,
    bars: () => flatten(app.fabric.committed).filter((n) => n.viewName === 'RNSTabsHostIOS'),
    front: () => [...live].filter((page) => page.inFront()).map((page) => page.name()),
    live: () => [...live].map((page) => page.name()).sort(),
  };
}

describe('a push to a page of the tab bar from a screen over it', () => {
  for (const [over, cover] of [
    ['pushed', (nav: NativeNavigation) => nav.push('/detail/1')],
    ['presented', (nav: NativeNavigation) => nav.present('/detail/1', { as: 'formSheet' })],
  ] as const) {
    it(`goes back to the bar from a screen ${over} over it`, async () => {
      const app = await boot();
      await cover(app.nav);
      await turns();
      assert.deepEqual(app.front(), ['detail/1']);

      assert.equal(await app.nav.push('/library'), true);
      await turns();
      assert.equal(app.router.url, '/library');
      assert.equal(app.bars().length, 1, 'one tab bar');
      assert.deepEqual(app.front(), ['library']);
      assert.deepEqual(app.live(), ['home', 'library'], 'the screen over the bar is gone');

      app.nav.back();
      await turns();
      assert.equal(app.router.url, '/home');
      assert.deepEqual(app.front(), ['home'], 'home is there, and in front');
    });
  }

  it("control: a page inside a tab nobody opened goes over the tab's first screen", async () => {
    const app = await boot();
    await app.nav.push('/detail/1');
    await turns();

    await app.nav.push('/library/3');
    await turns();
    assert.equal(app.router.url, '/library/3');
    assert.equal(app.bars().length, 1);
    assert.deepEqual(app.front(), ['library/3']);

    app.nav.back();
    await turns();
    assert.equal(app.router.url, '/library');
    assert.deepEqual(app.front(), ['library']);
  });

  it("pushes onto the tab's stack where it was left", async () => {
    const app = await boot();
    await app.nav.push('/library/2');
    await turns();
    await app.router.navigateByUrl('/home');
    await turns();
    await app.nav.push('/detail/1');
    await turns();

    await app.nav.push('/library/3');
    await turns();
    assert.deepEqual(app.front(), ['library/3']);
    app.nav.back();
    await turns();
    assert.equal(app.router.url, '/library/2', 'the page the tab was on is under it');
  });

  it("presents a page of the bar's tab in front over a screen presented over the bar", async () => {
    // The tab in front is behind the screen over the bar all the same, so the page goes to the
    // app's presented outlet, as a page of another tab does.
    const app = await boot();
    await app.router.navigateByUrl('/library');
    await turns();
    await app.nav.present('/detail/1', { as: 'modal' });
    await turns();

    await app.nav.present('/library/3', { as: 'fullScreenModal' });
    await turns();
    assert.equal(app.router.url, '/detail/1(presented:library/3)');
    assert.equal(app.bars().length, 1);
    assert.deepEqual(app.front(), ['library/3']);

    app.nav.back();
    await turns();
    assert.equal(app.router.url, '/detail/1');
    assert.deepEqual(app.front(), ['detail/1']);
  });

  for (const [how, push] of [
    ['written into the url', (nav: NativeNavigation) => nav.push('/library/2?filter=new')],
    [
      'given as extras',
      (nav: NativeNavigation) => nav.push('/library/2', { queryParams: { filter: 'new' } }),
    ],
  ] as const) {
    it(`keeps the query of a push to the page the tab was left on, ${how}`, async () => {
      const app = await boot();
      await app.nav.push('/library/2');
      await turns();
      await app.router.navigateByUrl('/home');
      await turns();
      await app.nav.push('/detail/1');
      await turns();

      await push(app.nav);
      await turns();
      assert.equal(app.router.url, '/library/2?filter=new');
    });
  }

  it('control: a push from the bar itself is unchanged', async () => {
    const app = await boot();
    await app.nav.push('/library/3');
    await turns();
    assert.deepEqual(app.front(), ['library/3']);
    app.nav.back();
    await turns();
    assert.deepEqual(app.front(), ['library']);
  });
});
