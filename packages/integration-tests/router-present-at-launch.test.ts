/**
 * A page of another tab presented while the app's first screen is still loading: a notification
 * tapped at launch that opens an invoice sheet. It goes over the first tab, as the same tap made a
 * second later does, and not into its own tab.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, render, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/tab-stacks.ts');
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The tab bar loads slowly, as a lazily loaded one does on a busy device. */
const slowly = (routes: Routes): Routes =>
  routes.map((route) =>
    route.path === ''
      ? {
          ...route,
          component: undefined,
          loadComponent: () => wait(60).then(() => mod['Bar'] as Type<unknown>),
        }
      : route,
  );

for (const [when, routes] of [
  ['at launch', () => slowly(mod['routes'] as Routes)],
  ['once the tab bar is up', () => mod['routes'] as Routes],
] as const) {
  it(`presents a page of another tab over the first tab, when asked for ${when}`, async () => {
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [provideNativeRouter(routes())],
    });
    const injector = app.componentRef.injector;
    const router = injector.get(Router);
    if (when === 'at launch') assert.equal(router.navigated, false, 'the tab bar is still loading');
    else await settle();
    assert.equal(await injector.get(NativeNavigation).present('/library/7'), true);
    for (let turn = 0; turn < 4; turn++) await settle();
    assert.equal(router.url, '/home(presented:library/7)', 'over home, with library left alone');
  });
}
