/**
 * A reset or a replace to a page whose guard sends the user somewhere else: signing out to a home
 * page that sends a signed-out user to the sign-in page. The router starts a new navigation for
 * the redirect, and the stack does to it what the first one asked for. A page that sends the user
 * on from its own `ngOnInit` is on the stack by then, and stays: what it superseded goes under it.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import {
  cleanup,
  render,
  settle,
  type FakeFabricNode,
  type RenderResult,
} from '@ng-native/testing';
import { DeepLinks } from '@ng-native/device';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter, withLinkParent } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/guard-redirect.ts', import.meta.url)),
  );
});

beforeEach(() => {
  (mod['session'] as { signedIn: boolean }).signedIn = false;
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const turns = async () => {
  for (let turn = 0; turn < 6; turn++) await settle();
};

/** The app with `A` and `B` on the stack. */
async function twoDeep() {
  const app = await render(mod['GuardedShell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['guardedRoutes'] as Routes)],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  const router = app.componentRef.injector.get(Router);
  await app.findByText('A');
  await nav.push('/b');
  await turns();
  return { app, nav, router };
}

const screens = (app: RenderResult<unknown>) =>
  flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen');

const pages = (app: RenderResult<unknown>) =>
  screens(app).map((screen) =>
    flatten([screen])
      .map((node) => node.props['text'])
      .find((text) => typeof text === 'string'),
  );

it('resets the stack to the page a guard redirects a reset to', async () => {
  const { app, nav, router } = await twoDeep();
  assert.equal(await nav.reset('/home'), true);
  await turns();
  assert.equal(router.url, '/login');
  assert.deepEqual(pages(app), ['Login']);
});

it('replaces the top screen with the page a guard redirects a replace to', async () => {
  const { app, nav, router } = await twoDeep();
  assert.equal(await nav.replace('/home'), true);
  await turns();
  assert.equal(router.url, '/login');
  assert.deepEqual(pages(app), ['A', 'Login']);
});

it('resets and replaces as before where the guard lets the navigation through', async () => {
  (mod['session'] as { signedIn: boolean }).signedIn = true;
  const replaced = await twoDeep();
  await replaced.nav.replace('/home');
  await turns();
  assert.deepEqual(pages(replaced.app), ['A', 'Home']);
  cleanup();

  const reset = await twoDeep();
  await reset.nav.reset('/home');
  await turns();
  assert.equal(reset.router.url, '/home');
  assert.deepEqual(pages(reset.app), ['Home']);
});

it('resets the stack under a page that navigates elsewhere as it is created', async () => {
  const { app, nav, router } = await twoDeep();
  await nav.reset('/bounce');
  await turns();
  assert.equal(router.url, '/login');
  assert.deepEqual(pages(app), ['Bounce', 'Login']);
});

it('replaces the top screen with a page that navigates elsewhere as it is created', async () => {
  const { app, nav, router } = await twoDeep();
  await nav.replace('/bounce');
  await turns();
  assert.equal(router.url, '/login');
  assert.deepEqual(pages(app), ['A', 'Bounce', 'Login']);
});

it('leaves only the page a reset page replaces itself with as it is created', async () => {
  const { app, nav, router } = await twoDeep();
  await nav.reset('/swap');
  await turns();
  assert.equal(router.url, '/login');
  assert.deepEqual(pages(app), ['Login']);

  nav.back();
  await turns();
  assert.equal(router.url, '/login', 'back has nowhere to go');
});

it('leaves the page a replacing page replaces itself with over the screens below', async () => {
  const { app, nav, router } = await twoDeep();
  await nav.replace('/swap');
  await turns();
  assert.equal(router.url, '/login');
  assert.deepEqual(pages(app), ['A', 'Login']);
});

it('presents the page a guard redirects a presentation to, the way it was asked for', async () => {
  const { app, nav, router } = await twoDeep();
  await nav.present('/home', { as: 'formSheet' });
  await turns();
  assert.equal(router.url, '/login');
  assert.deepEqual(pages(app), ['A', 'B', 'Login']);
  assert.equal(screens(app)[2]!.props['stackPresentation'], 'formSheet');
});

it('leaves a later navigation of its own to do what it asks', async () => {
  const { app, nav, router } = await twoDeep();
  await nav.reset('/home');
  await turns();
  await router.navigateByUrl('/a');
  await turns();
  assert.equal(router.url, '/a');
  assert.deepEqual(pages(app), ['Login', 'A'], 'pushed, not a second reset');
  await router.navigateByUrl('/home');
  await turns();
  assert.equal(router.url, '/login');
  assert.deepEqual(pages(app), ['Login'], 'a plain navigation back to a kept page, not a push');
});

it("keeps the intent through a route config's own redirect", async () => {
  const replaced = await twoDeep();
  await replaced.nav.replace('/sign-in');
  await turns();
  assert.equal(replaced.router.url, '/login');
  assert.deepEqual(pages(replaced.app), ['A', 'Login']);
  cleanup();

  const reset = await twoDeep();
  await reset.nav.reset('/sign-in');
  await turns();
  assert.deepEqual(pages(reset.app), ['Login']);
});

it('resets the stack to the page on top when a guard redirects a reset to its url', async () => {
  const { app, nav, router } = await twoDeep();
  await router.navigateByUrl('/login');
  await turns();
  assert.deepEqual(pages(app), ['A', 'B', 'Login']);

  await nav.reset('/home');
  await turns();
  assert.equal(router.url, '/login');
  assert.deepEqual(pages(app), ['Login'], 'the router skips the same url, and the stack resets');

  await router.navigateByUrl('/b');
  await turns();
  assert.deepEqual(pages(app), ['Login', 'B'], 'pushed, not a second reset');
});

it('resets the stack to the page on top for a reset to its own url', async () => {
  const { app, nav, router } = await twoDeep();
  await nav.reset('/b');
  await turns();
  assert.equal(router.url, '/b');
  assert.deepEqual(pages(app), ['B']);
});

/** The app with `A`, `B` and `Login` on the stack, at `/login`. */
async function onLogin() {
  const deep = await twoDeep();
  await deep.router.navigateByUrl('/login');
  await turns();
  assert.deepEqual(pages(deep.app), ['A', 'B', 'Login']);
  return deep;
}

it("resets the stack to the page on top when the route config's redirect lands there", async () => {
  const { app, nav, router } = await onLogin();
  assert.equal(await nav.reset('/sign-in'), true);
  await turns();
  assert.equal(router.url, '/login');
  assert.deepEqual(pages(app), ['Login']);
});

it('resets the stack to the page on top for a reset to its url with another query', async () => {
  const { app, nav, router } = await onLogin();
  assert.equal(await nav.reset('/login?x=1'), true);
  await turns();
  assert.equal(router.url, '/login?x=1');
  assert.deepEqual(pages(app), ['Login']);
  assert.equal(nav.back(), undefined);
  await turns();
  assert.deepEqual(pages(app), ['Login'], 'nothing under it to go back to');
});

it('resets the stack to the page on top when a guard redirects a reset to another url of it', async () => {
  const { app, nav, router } = await onLogin();
  assert.equal(await nav.reset('/account'), true);
  await turns();
  assert.equal(router.url, '/login?next=account');
  assert.deepEqual(pages(app), ['Login']);
});

it('leaves the stack alone for a replace that lands on the page on top', async () => {
  const { app, nav, router } = await onLogin();
  assert.equal(await nav.replace('/login?x=1'), true);
  await turns();
  assert.equal(router.url, '/login?x=1');
  assert.deepEqual(pages(app), ['A', 'B', 'Login']);
});

it('resets to another page as before, and leaves a later navigation to the page on top alone', async () => {
  const { app, nav, router } = await onLogin();
  await nav.reset('/a');
  await turns();
  assert.deepEqual(pages(app), ['A']);

  await router.navigateByUrl('/b');
  await turns();
  await router.navigateByUrl('/b?x=1');
  await turns();
  assert.equal(router.url, '/b?x=1');
  assert.deepEqual(pages(app), ['A', 'B'], 'not reset by the earlier one');
});

it('leaves a later navigation to the page on top alone after a reset onto it', async () => {
  const { app, nav, router } = await onLogin();
  await nav.reset('/login?x=1');
  await turns();
  await router.navigateByUrl('/b');
  await turns();
  await router.navigateByUrl('/b?y=2');
  await turns();
  assert.deepEqual(pages(app), ['Login', 'B'], 'not reset by the earlier one');
});

it('follows a link the app launched with over the page a guard sent its parent to', async () => {
  // The first navigation is cancelled for the redirect's, which is the one that shows a page.
  const app = await render(mod['GuardedShell'] as Type<unknown>, {
    providers: [
      provideNativeRouter(
        mod['guardedRoutes'] as Routes,
        withLinkParent((url) => (url === '/b' ? '/home' : null)),
      ),
      { provide: DeepLinks, useValue: { initialUrl: () => '/b', subscribe: () => () => {} } },
    ],
  });
  await turns();
  assert.equal(app.componentRef.injector.get(Router).url, '/b');
  assert.deepEqual(pages(app), ['Login', 'B']);
});
