/**
 * A development reload comes back on the page it left: the router leaves its history with the dev
 * server before the app goes, and the app that comes back collects it and goes through it again.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, render, screen, type FakeFabricNode } from '@ng-native/testing';
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
  mod = await compileFixture(fileURLToPath(new URL('./fixtures/about-pages.ts', import.meta.url)));
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
