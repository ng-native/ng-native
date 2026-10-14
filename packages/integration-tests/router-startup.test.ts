/**
 * A screen asked for while the app's first screen is still loading: a notification tapped at
 * launch, a redirect in a root component's constructor, a test that pushes at once. The router's
 * first navigation is still running, a lazily loaded root route waiting on its import, and a new
 * navigation cancels it, so the app opened on the pushed screen with nothing beneath it and Back
 * had nowhere to go.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import { inject, type Type } from '@angular/core';
import { NavigationEnd, Router, type Routes } from '@angular/router';
import { DeepLinks } from '@ng-native/device';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter, withLinkParent } from '../router/src/provide-native-router.ts';
import { ROUTE_PARKING } from '../router/src/route-parking.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/guarded-sheet.ts');
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The root route loads slowly, as a lazily loaded one does on a busy device. */
const slowly = (routes: Routes): Routes => [
  { path: '', loadComponent: () => wait(60).then(() => mod['GuardHome'] as Type<unknown>) },
  ...routes.filter((route) => route.path !== ''),
];

for (const [how, go] of [
  ['pushed', (nav: NativeNavigation) => nav.push('/editor')],
  ['presented', (nav: NativeNavigation) => nav.present('/editor', { as: 'formSheet' })],
] as const) {
  it(`puts a screen ${how} before the first screen loaded above that screen`, async () => {
    const app = await render(mod['GuardShell'] as Type<unknown>, {
      providers: [provideNativeRouter(slowly(mod['guardRoutes'] as Routes))],
    });
    const injector = app.componentRef.injector;
    const router = injector.get(Router);
    assert.equal(router.navigated, false, 'the first navigation is still loading');
    await go(injector.get(NativeNavigation));
    for (let turn = 0; turn < 4; turn++) await settle();
    const screens = flatten(app.fabric.committed).filter((n) => n.viewName === 'RNSScreen');
    assert.equal(screens.length, 2, 'the first screen, and the one asked for above it');
    assert.equal(router.url, '/editor');
    const texts = JSON.stringify(screens[0]);
    assert.match(texts, /"text":"home"/, 'the first screen is the root');
  });
}

it('keeps a guard redirect on the first navigation when a screen is pushed before it lands', async () => {
  // A root guard that sends the app elsewhere - to sign in, say - cancels the first navigation
  // with a redirect and starts another. A push waiting for the first navigation that went on
  // that cancel superseded the redirect, and the pushed screen opened alone, past the guard.
  // The guard redirects when the test lets it, so the push is sure to start while it holds.
  let redirect!: () => void;
  const guarded = new Promise<void>((resolve) => (redirect = resolve));
  const routes: Routes = [
    {
      path: '',
      component: mod['GuardHome'] as Type<unknown>,
      canActivate: [
        () => {
          const router = inject(Router);
          return guarded.then(() => router.parseUrl('/welcome'));
        },
      ],
    },
    { path: 'welcome', component: mod['GuardHome'] as Type<unknown> },
    ...(mod['guardRoutes'] as Routes).filter((route) => route.path !== ''),
  ];
  const app = await render(mod['GuardShell'] as Type<unknown>, {
    providers: [provideNativeRouter(routes)],
  });
  const injector = app.componentRef.injector;
  const router = injector.get(Router);
  const landed: string[] = [];
  router.events.subscribe((event) => {
    if (event instanceof NavigationEnd) landed.push(event.urlAfterRedirects);
  });
  assert.equal(router.navigated, false, 'the first navigation is still in its guard');
  let pushed = false;
  const push = injector.get(NativeNavigation).push('/editor');
  void push.then(() => (pushed = true));
  await settle();
  assert.equal(pushed, false, 'the push waits while the guard holds');
  redirect();
  await push;
  for (let turn = 0; turn < 4; turn++) await settle();
  assert.deepEqual(landed, ['/welcome', '/editor'], 'the redirect lands, then the push');
  const screens = flatten(app.fabric.committed).filter((n) => n.viewName === 'RNSScreen');
  assert.equal(screens.length, 2, 'the redirect target, and the screen pushed above it');
  assert.match(JSON.stringify(screens[0]), /"text":"home"/);
});

/** A root guard's redirect that waits until the test releases it. */
function held() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return { gate, release };
}

/** Routes whose root guard waits on `gate`, then sends the app to `/welcome`, as a sign-in does. */
const redirecting = (gate: Promise<void>): Routes => [
  {
    path: '',
    component: mod['GuardHome'] as Type<unknown>,
    canActivate: [
      () => {
        const router = inject(Router);
        return gate.then(() => router.parseUrl('/welcome'));
      },
    ],
  },
  { path: 'welcome', component: mod['GuardHome'] as Type<unknown> },
  ...(mod['guardRoutes'] as Routes).filter((route) => route.path !== ''),
];

/** The app with a link source to deliver through, and every url a navigation landed on. */
async function launched(providers: unknown[]) {
  let deliver: (url: string) => void = () => {};
  const app = await render(mod['GuardShell'] as Type<unknown>, {
    providers: [
      ...(providers as never[]),
      {
        provide: DeepLinks.SOURCE,
        useValue: {
          launchUrl: () => Promise.resolve(null),
          subscribe: (listener: (url: string) => void) => ((deliver = listener), () => {}),
          open: () => {},
        },
      },
    ],
  });
  const router = app.componentRef.injector.get(Router);
  const landed: string[] = [];
  router.events.subscribe((event) => {
    if (event instanceof NavigationEnd) landed.push(event.urlAfterRedirects);
  });
  assert.equal(router.navigated, false, 'the first navigation is still in its guard');
  const arrived = async () => {
    await wait(100);
    for (let turn = 0; turn < 4; turn++) await settle();
    return landed;
  };
  return { deliver: (url: string) => deliver(url), arrived };
}

it('keeps a guard redirect when a link arrives before it lands', async () => {
  // A link is a push, and waits as one does.
  const hold = held();
  const app = await launched([provideNativeRouter(redirecting(hold.gate))]);
  app.deliver('app://editor');
  hold.release();
  assert.deepEqual(await app.arrived(), ['/welcome', '/editor']);
});

it('keeps it when links have a parent page, which is another way in for a link', async () => {
  // `withLinkParent` follows a link through the router itself, with a wait of its own.
  const hold = held();
  const app = await launched([
    provideNativeRouter(
      redirecting(hold.gate),
      withLinkParent(() => null),
    ),
  ]);
  app.deliver('app://editor');
  hold.release();
  assert.deepEqual(await app.arrived(), ['/welcome', '/editor']);
});

it('keeps it when a reload left a page to come back to', async () => {
  // Development, as an app that reloads itself is: a release build has no history to leave.
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  try {
    const hold = held();
    const app = await launched([
      provideNativeRouter(redirecting(hold.gate)),
      {
        provide: ROUTE_PARKING,
        useValue: { park: async () => {}, collect: async () => [{ url: '/editor' }] },
      },
    ]);
    hold.release();
    assert.deepEqual(await app.arrived(), ['/welcome', '/editor']);
  } finally {
    delete (globalThis as { __DEV__?: boolean }).__DEV__;
  }
});
