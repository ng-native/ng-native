/**
 * A plain `Router.navigate()` to a url further down the stack goes back to the screen already
 * there, and back through history to that screen's entry, as `popTo()` does: the history holds no
 * entries for the screens above it that the navigation took off, and Back goes to the screen below.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { PlatformLocation } from '@angular/common';
import { Router, withComponentInputBinding, withRouterConfig, type Routes } from '@angular/router';
import { cleanup, render, settle, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation, intentOf } from '../router/src/native-navigation.ts';
import { NativePlatformLocation } from '../router/src/native-platform-location.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { followLink } from '../router/src/native-links.ts';
import { compileFixture } from './compile.ts';

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function idle(): Promise<void> {
  for (let turn = 0; turn < 6; turn++) await settle();
}

/** What each screen in the stack says, bottom first. */
const stack = (fabric: FakeFabric) =>
  flatten(fabric.committed)
    .filter((node) => node.viewName === 'RNSScreen')
    .map((screen) =>
      flatten(screen.children)
        .map((node) => node.props['text'])
        .filter((text) => typeof text === 'string')
        .join(' '),
    );

describe('a plain navigation to a url further down the stack', () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let nav: NativeNavigation;
  let fabric: FakeFabric;
  let history: NativePlatformLocation;
  let created: Record<string, number>;
  let live: Record<string, number>;

  /** The history up to the page showing, oldest first. */
  const historyOf = () => history.ɵpages().map((page) => page.url);

  before(async () => {
    mod = await compileFixture('fixtures/stack-app.ts');
    created = mod['created'] as Record<string, number>;
    live = mod['live'] as Record<string, number>;
  });

  beforeEach(async () => {
    for (const counts of [live, created]) for (const key of Object.keys(counts)) delete counts[key];
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [provideNativeRouter(mod['routes'] as Routes, withComponentInputBinding())],
    });
    fabric = app.fabric;
    router = app.componentRef.injector.get(Router);
    nav = app.componentRef.injector.get(NativeNavigation);
    history = app.componentRef.injector.get(PlatformLocation) as NativePlatformLocation;
    await nav.push('/user/1');
    await nav.push('/user/2');
    await idle();
  });

  afterEach(() => cleanup());

  it('goes back through history to its entry, and Back goes to the screen below', async () => {
    assert.equal(await router.navigateByUrl('/user/1'), true);
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'user 1']);
    assert.equal(created['User'], 2, 'user 1 is the screen that was there');
    assert.deepEqual(historyOf(), ['/', '/user/1']);

    nav.back();
    await idle();
    assert.equal(router.url, '/');
    assert.deepEqual(stack(fabric), ['home']);
    assert.deepEqual(historyOf(), ['/']);
  });

  it('goes back over several screens, from Router.navigate as from navigateByUrl', async () => {
    await nav.push('/user/3');
    await idle();
    assert.equal(await router.navigate(['/user', '1']), true);
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'user 1']);
    assert.deepEqual(historyOf(), ['/', '/user/1']);

    await nav.push('/user/4');
    await idle();
    assert.deepEqual(historyOf(), ['/', '/user/1', '/user/4'], 'and a push from there stacks');
    nav.back();
    await idle();
    assert.equal(router.url, '/user/1');
    nav.back();
    await idle();
    assert.equal(router.url, '/');
    assert.deepEqual(stack(fabric), ['home']);
  });

  it('goes back to the root screen, leaving one entry', async () => {
    await router.navigateByUrl('/');
    await idle();
    assert.deepEqual(stack(fabric), ['home']);
    assert.deepEqual(historyOf(), ['/']);
  });

  it('goes back to its entry when the navigation replaces the url too', async () => {
    await router.navigateByUrl('/user/1', { replaceUrl: true });
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'user 1']);
    assert.deepEqual(historyOf(), ['/', '/user/1']);
  });

  it('leaves the history alone for a navigation that skips the location change', async () => {
    await router.navigateByUrl('/user/1', { skipLocationChange: true });
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'user 1']);
    assert.deepEqual(historyOf(), ['/', '/user/1', '/user/2']);

    nav.back();
    await idle();
    assert.equal(router.url, '/');
    assert.deepEqual(stack(fabric), ['home']);
  });

  it('counts no entry for a screen above it that skipped the location change', async () => {
    await router.navigateByUrl('/user/3', { skipLocationChange: true });
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'user 1', 'user 2', 'user 3']);
    assert.deepEqual(historyOf(), ['/', '/user/1', '/user/2']);

    assert.equal(await router.navigateByUrl('/user/1'), true);
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'user 1']);
    assert.deepEqual(historyOf(), ['/', '/user/1']);
  });

  it('counts the screens dropped in a stack inside a screen too', async () => {
    await nav.popToRoot();
    await nav.push('/compose');
    await nav.push('/compose/step');
    await nav.push('/user/1');
    await idle();
    assert.deepEqual(historyOf(), ['/', '/compose', '/compose/step', '/user/1']);

    assert.equal(await router.navigateByUrl('/compose'), true);
    await idle();
    assert.equal(router.url, '/compose');
    assert.deepEqual(historyOf(), ['/', '/compose']);
  });

  it('goes back to a tab bar a screen was pushed over, at the tab it was left on', async () => {
    await router.navigateByUrl('/wrapped-tabs/schedule');
    await router.navigateByUrl('/wrapped-tabs/speakers');
    await nav.push('/user/3');
    await idle();
    assert.equal(stack(fabric).at(-1), 'user 3');
    assert.equal(await router.navigateByUrl('/wrapped-tabs/speakers'), true);
    await idle();
    assert.equal(live['User'], 2, 'the screen over the bar is gone');
    assert.deepEqual(historyOf(), [
      '/',
      '/user/1',
      '/user/2',
      '/wrapped-tabs/schedule',
      '/wrapped-tabs/speakers',
    ]);

    await router.navigateByUrl('/wrapped-tabs/schedule');
    await idle();
    assert.equal(router.url, '/wrapped-tabs/schedule', 'a tab switch from there');
    assert.equal(historyOf().at(-1), '/wrapped-tabs/schedule');
  });

  it('keeps the entry it goes back to, with the id of the navigation that went there', async () => {
    await nav.present('/user/3', { as: 'formSheet' });
    await nav.push('/user/4');
    await idle();
    await router.navigateByUrl('/user/3');
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'user 1', 'user 2', 'user 3']);
    const state = history.getState() as Record<string, unknown>;
    assert.equal(intentOf(state)?.presentation?.stackPresentation, 'formSheet');
    assert.equal(state['navigationId'], router.lastSuccessfulNavigation()?.id);
  });

  it('leaves a tab stack whose history went through another tab to the router', async () => {
    await router.navigateByUrl('/wrapped-tabs/venues');
    await nav.push('/wrapped-tabs/venues/1');
    await nav.push('/wrapped-tabs/venues/2');
    await router.navigateByUrl('/wrapped-tabs/schedule');
    await router.navigateByUrl('/wrapped-tabs/venues/2');
    await idle();
    assert.equal(await router.navigateByUrl('/wrapped-tabs/venues/1'), true);
    await idle();
    assert.equal(router.url, '/wrapped-tabs/venues/1');
    assert.equal(historyOf().at(-1), '/wrapped-tabs/venues/1');
    assert.equal(historyOf().at(-2), '/wrapped-tabs/venues/2');
  });

  it('leaves the history matching the stack when a link opens its parent pages', async () => {
    await nav.push('/user/3');
    await idle();
    const parentOf = (url: string) => (url === '/user/2' ? '/user/1' : null);
    await followLink(router, '/user/2', parentOf);
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'user 1', 'user 2']);
    assert.deepEqual(historyOf(), ['/', '/user/1', '/user/2']);

    nav.back();
    await idle();
    assert.equal(router.url, '/user/1');
    assert.deepEqual(stack(fabric), ['home', 'user 1']);
  });
});

describe('a plain navigation to a url further down the stack, with computed cancel resolution', () => {
  afterEach(() => cleanup());

  it('leaves the history to the router, whose page ids it would put out of step', async () => {
    const mod = await compileFixture('fixtures/stack-app.ts');
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(
          mod['routes'] as Routes,
          withComponentInputBinding(),
          withRouterConfig({ canceledNavigationResolution: 'computed' }),
        ),
      ],
    });
    const router = app.componentRef.injector.get(Router);
    const nav = app.componentRef.injector.get(NativeNavigation);
    const history = app.componentRef.injector.get(PlatformLocation) as NativePlatformLocation;
    await nav.push('/user/1');
    await nav.push('/user/2');
    await idle();

    assert.equal(await router.navigateByUrl('/user/1'), true);
    await idle();
    assert.deepEqual(
      history.ɵpages().map((page) => page.url),
      ['/', '/user/1', '/user/2', '/user/1'],
    );
  });
});
