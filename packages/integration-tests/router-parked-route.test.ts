/**
 * A development reload comes back on the page it left: the router leaves its history with the dev
 * server before the app goes, and the app that comes back collects it and goes through it again.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { ErrorHandler, type Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, render, screen, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { ROUTE_PARKING, type ParkedPage, type RouteParking } from '../router/src/route-parking.ts';
import { provideNativeRouter, withLinkParent } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

// Development, as an app that reloads itself is: a release build has no history to leave.
beforeEach(() => void ((globalThis as { __DEV__?: boolean }).__DEV__ = true));
afterEach(async () => {
  await cleanup();
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
});

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/about-pages.ts');
});

const park = () =>
  (globalThis as { __angularNativePark?: () => Promise<void> }).__angularNativePark;

const app = (parking: RouteParking) =>
  render(mod['App'] as Type<unknown>, {
    providers: [
      provideNativeRouter(mod['routes'] as Routes),
      { provide: ROUTE_PARKING, useValue: parking },
    ],
  });

it('comes back on the page a reload left, above the pages that led to it', async () => {
  await app({
    park: async () => {},
    collect: async () => [{ url: '/' }, { url: '/about' }, { url: '/about/team' }],
  });

  assert.ok(await screen.findByText('Our team'));
  assert.ok(screen.getByText('We make apps'), 'the page it was reached from is beneath it');
});

it('goes back through its history as well when links have a parent page', async () => {
  // `withLinkParent` gives the router another location and another way in for a link.
  await render(mod['App'] as Type<unknown>, {
    providers: [
      provideNativeRouter(
        mod['routes'] as Routes,
        withLinkParent((url) => (url.startsWith('/about/') ? '/about' : null)),
      ),
      {
        provide: ROUTE_PARKING,
        useValue: {
          park: async () => {},
          collect: async () => [{ url: '/' }, { url: '/about' }, { url: '/about/team' }],
        },
      },
    ],
  });

  assert.ok(await screen.findByText('Our team'));
  assert.ok(screen.getByText('We make apps'), 'the page it was reached from is beneath it');
});

it('starts where it always does when no reload left anything', async () => {
  const { componentRef } = await app({ park: async () => {}, collect: async () => null });

  assert.ok(await screen.findByText('Home'));
  assert.equal(componentRef.injector.get(Router).url, '/');
});

it('leaves its history, up to the page showing, when the app is about to reload', async () => {
  const parked: ParkedPage[][] = [];
  const { componentRef } = await app({
    park: async (pages) => void parked.push(pages),
    collect: async () => null,
  });
  await componentRef.injector.get(Router).navigateByUrl('/about');
  await componentRef.injector.get(NativeNavigation).present('/about/team', { as: 'formSheet' });

  await park()!();

  assert.deepEqual(parked, [
    [
      { url: '/' },
      { url: '/about' },
      { url: '/about/team', presentation: { stackPresentation: 'formSheet' } },
    ],
  ]);
});

it('leaves out a round trip, which the app that comes back has no use for', async () => {
  const parked: ParkedPage[][] = [];
  const { componentRef } = await app({
    park: async (pages) => void parked.push(pages),
    collect: async () => null,
  });
  const router = componentRef.injector.get(Router);
  for (const url of ['/about', '/', '/about/team']) await router.navigateByUrl(url);

  await park()!();

  assert.deepEqual(parked, [[{ url: '/' }, { url: '/about/team' }]]);
});

it('brings a page that was presented back presented, not pushed', async () => {
  const { fabric } = await app({
    park: async () => {},
    collect: async () => [
      { url: '/' },
      { url: '/about', presentation: { stackPresentation: 'formSheet' } },
    ],
  });

  assert.ok(await screen.findByText('We make apps'));
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  const screens = all(fabric.committed).filter((node) => node.viewName === 'RNSScreen');
  assert.equal(screens.at(-1)!.props['stackPresentation'], 'formSheet');
});

it('takes its hook away with the app, and installs none without somewhere to park', async () => {
  await app({ park: async () => {}, collect: async () => null });
  assert.equal(typeof park(), 'function');
  await cleanup();
  assert.equal(park(), undefined, 'gone with the app that set it');

  // A test and the web have no dev server: the token's own factory says so.
  await render(mod['App'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['routes'] as Routes)],
  });
  assert.equal(park(), undefined);
  await cleanup();

  // And a release build installs none whatever it is given.
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  await app({ park: async () => {}, collect: async () => null });
  assert.equal(park(), undefined);
});

describe('a page of another tab presented over the tab in front', () => {
  let tabs: Record<string, unknown>;
  before(async () => {
    tabs = await compileFixture('fixtures/tab-stacks.ts');
  });

  async function tabApp(parking: RouteParking) {
    const errors: unknown[] = [];
    const rendered = await render(tabs['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(tabs['routes'] as Routes),
        { provide: ROUTE_PARKING, useValue: parking },
        { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
      ],
    });
    await (globalThis as { __angularNativeRestoring?: Promise<void> }).__angularNativeRestoring;
    for (let turn = 0; turn < 5; turn++) await settle();
    return { ...rendered, router: rendered.componentRef.injector.get(Router), errors };
  }

  it('leaves the url with the page in the presented outlet', async () => {
    const parked: ParkedPage[][] = [];
    const { componentRef } = await tabApp({
      park: async (pages) => void parked.push(pages),
      collect: async () => null,
    });
    await componentRef.injector.get(NativeNavigation).present('/library/7', { as: 'formSheet' });
    await park()!();
    assert.deepEqual(parked.at(-1)!.at(-1), {
      url: '/home(presented:library/7)',
      presentation: { stackPresentation: 'formSheet' },
    });
  });

  for (const [id, written] of [
    ['7', '7'],
    ['Giant Steps', 'Giant%20Steps'],
    ['AC/DC', 'AC%2FDC'],
  ]) {
    it(`comes back with ${id} presented over the tab it was over, with no error`, async () => {
      const url = `/home(presented:library/${written})`;
      const { router, errors, fabric } = await tabApp({
        park: async () => {},
        collect: async () => [
          { url: '/home' },
          { url, presentation: { stackPresentation: 'formSheet' } },
        ],
      });
      assert.deepEqual(errors, []);
      assert.equal(router.url, url);
      const sheet = router.routerState.snapshot.root.children.find(
        (route) => route.outlet === 'presented',
      );
      let page = sheet;
      while (page?.firstChild) page = page.firstChild;
      assert.equal(page?.paramMap.get('id'), id);
      const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
        nodes.flatMap((node) => [node, ...all(node.children)]);
      const screens = all(fabric.committed).filter((node) => node.viewName === 'RNSScreen');
      assert.equal(screens.at(-1)!.props['stackPresentation'], 'formSheet');
    });
  }
});
