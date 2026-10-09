/**
 * A screen asked for while the app's first screen is still loading: a notification tapped at
 * launch, a redirect in a root component's constructor, a test that pushes at once. The router's
 * first navigation is still running, a lazily loaded root route waiting on its import, and a new
 * navigation cancels it, so the app opened on the pushed screen with nothing beneath it and Back
 * had nowhere to go.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
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
