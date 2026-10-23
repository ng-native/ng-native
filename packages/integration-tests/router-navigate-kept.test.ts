/**
 * A plain `Router.navigate()` to a url further down the stack goes back to the screen already
 * there, and back through history to that screen's entry, as `popTo()` does: the history holds no
 * entries for the screens above it that the navigation took off, and Back goes to the screen below.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { ErrorHandler, type Type } from '@angular/core';
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

describe('a navigation to a url further down the stack that fails or is cancelled', () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let nav: NativeNavigation;
  let fabric: FakeFabric;
  let history: NativePlatformLocation;
  let created: Record<string, number>;
  let live: Record<string, number>;

  let composeInFront: (() => boolean)[];

  const historyOf = () => history.ɵpages().map((page) => page.url);
  /** The native screens in the app's own stack, by tag, bottom first. */
  const screens = () =>
    flatten(fabric.committed)
      .find((node) => node.viewName === 'RNSScreenStack')!
      .children.map((screen) => screen.reactTag);
  const failed = (navigation: Promise<boolean>) =>
    navigation.then(
      () => assert.fail('the navigation succeeded'),
      (error: unknown) => error,
    );

  before(async () => {
    mod = await compileFixture('fixtures/stack-app.ts');
    created = mod['created'] as Record<string, number>;
    live = mod['live'] as Record<string, number>;
    composeInFront = mod['composeInFront'] as (() => boolean)[];
  });

  beforeEach(async () => {
    for (const counts of [live, created]) for (const key of Object.keys(counts)) delete counts[key];
    composeInFront.length = 0;
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['routes'] as Routes, withComponentInputBinding()),
        { provide: ErrorHandler, useValue: { handleError() {} } },
      ],
    });
    fabric = app.fabric;
    router = app.componentRef.injector.get(Router);
    nav = app.componentRef.injector.get(NativeNavigation);
    history = app.componentRef.injector.get(PlatformLocation) as NativePlatformLocation;
    await nav.push('/compose');
    await nav.push('/user/1');
    await idle();
  });

  afterEach(() => cleanup());

  it('puts back the screens it took off, and Back still goes down the stack', async () => {
    const before = screens();
    await failed(router.navigateByUrl('/compose/broken'));
    await idle();
    assert.equal(router.url, '/user/1');
    assert.deepEqual(stack(fabric), ['home', 'start', 'start', 'user 1']);
    assert.deepEqual(screens(), before, 'the same native screens');
    assert.equal(composeInFront[0]!(), false, 'compose is covered again');
    assert.equal(created['User'], 1, 'user 1 is the screen that was there');
    assert.equal(live['User'], 1);
    assert.deepEqual(historyOf(), ['/', '/compose', '/user/1']);

    nav.back();
    await idle();
    assert.equal(router.url, '/compose');
    assert.deepEqual(stack(fabric), ['home', 'start', 'start']);
    assert.equal(created['Compose'], 1, 'compose is the screen kept for it, not a second one');
    assert.equal(live['User'], 0);
    assert.deepEqual(historyOf(), ['/', '/compose']);

    nav.back();
    await idle();
    assert.equal(router.url, '/');
    assert.deepEqual(stack(fabric), ['home']);
  });

  it('goes back to the kept screen afterwards as if the failure had not happened', async () => {
    await failed(router.navigateByUrl('/compose/broken'));
    await idle();
    assert.equal(await router.navigateByUrl('/compose'), true);
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'start', 'start']);
    assert.equal(created['Compose'], 1);
    assert.equal(live['User'], 0);
    assert.deepEqual(historyOf(), ['/', '/compose']);
  });

  it('leaves Back working for a failed page under the screen on top', async () => {
    nav.back();
    await idle();
    assert.equal(router.url, '/compose');
    await failed(router.navigateByUrl('/compose/broken'));
    await idle();
    assert.equal(router.url, '/compose');
    assert.deepEqual(stack(fabric), ['home', 'start', 'start']);

    nav.back();
    await idle();
    assert.equal(router.url, '/');
    assert.deepEqual(stack(fabric), ['home']);
  });

  it('leaves Back working for a failed page under a screen in a stack inside the top one', async () => {
    await nav.push('/draft');
    await nav.push('/draft/nested');
    await idle();
    await failed(router.navigateByUrl('/draft/nested/broken'));
    await idle();
    assert.equal(router.url, '/draft/nested');

    nav.back();
    await idle();
    assert.equal(router.url, '/draft', 'the stack inside the draft takes the Back');
  });

  it('keeps a page under a route with no component as a page after a failure', async () => {
    const members = mod['members'] as { note: { set(value: string): void } }[];
    members.length = 0;
    await nav.push('/member/1');
    await idle();
    members[0]!.note.set('edited');
    await failed(router.navigateByUrl('/broken'));
    await idle();
    assert.equal(router.url, '/member/1');

    await nav.push('/user/2');
    await idle();
    assert.equal(live['Member'], 1, 'the page pushed from is kept');
    nav.back();
    await idle();
    assert.equal(router.url, '/member/1');
    assert.deepEqual(stack(fabric).at(-1), 'member edited');
    assert.equal(created['Member'], 1, 'the same page, not a new one');
  });

  it('keeps a page in a group of routes as a page after a failure', async () => {
    await nav.push('/grouped');
    await idle();
    await failed(router.navigateByUrl('/broken'));
    await idle();
    await nav.push('/user/2');
    await idle();
    assert.equal(live['Grouped'], 1, 'the page pushed from is kept');
    nav.back();
    await idle();
    assert.equal(router.url, '/grouped');
    assert.equal(created['Grouped'], 1, 'the same page, not a new one');
  });

  it('leaves Back working for a failed page under a screen behind a loadChildren wrapper', async () => {
    await nav.push('/lazy-compose');
    await idle();
    await failed(router.navigateByUrl('/lazy-compose/broken'));
    await idle();
    assert.equal(router.url, '/lazy-compose');

    nav.back();
    await idle();
    assert.equal(router.url, '/user/1', 'the app stack takes the Back');
  });

  it('leaves no rewind behind for the next navigation to make', async () => {
    await failed(router.navigateByUrl('/compose/broken'));
    await idle();
    await nav.push('/compose');
    await idle();
    assert.deepEqual(historyOf(), ['/', '/compose', '/user/1', '/compose']);
  });

  it('leaves the history as it was when the navigation replaces the url too', async () => {
    await failed(router.navigateByUrl('/compose/broken', { replaceUrl: true }));
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'start', 'start', 'user 1']);
    assert.deepEqual(historyOf(), ['/', '/compose', '/user/1']);
  });

  it('puts back a screen holding a stack, and a push into that stack lands in it', async () => {
    await nav.push('/draft');
    await idle();
    await failed(router.navigateByUrl('/compose/broken'));
    await idle();
    assert.equal(router.url, '/draft');
    assert.deepEqual(stack(fabric), ['home', 'start', 'start', 'user 1', 'start', 'start']);

    await nav.push('/draft/step');
    await idle();
    assert.equal(router.url, '/draft/step');
    assert.deepEqual(stack(fabric), [
      'home',
      'start',
      'start',
      'user 1',
      'start step',
      'start',
      'step',
    ]);
    assert.equal(created['Compose'], 2, 'compose and the draft, no third');
  });

  it('puts the screens back for a Back that fails too', async () => {
    // A failure as the router attaches the start page inside compose, after compose itself: a
    // handle taken out is the activation's, where the router state is built before it.
    const strategy = router.routeReuseStrategy;
    const store = strategy.store.bind(strategy);
    let fail = true;
    strategy.store = (route, handle) => {
      if (fail && !handle && route.component === mod['ComposeStart']) {
        fail = false;
        throw new Error('no start');
      }
      store(route, handle);
    };
    nav.back();
    await idle();
    assert.equal(fail, false, 'the Back reached the start page');
    assert.equal(router.url, '/user/1');
    assert.deepEqual(stack(fabric), ['home', 'start', 'start', 'user 1']);
    assert.equal(live['User'], 1);

    nav.back();
    await idle();
    assert.equal(router.url, '/compose');
    assert.deepEqual(stack(fabric), ['home', 'start', 'start']);
    assert.equal(created['Compose'], 1);
  });

  it('takes the screens off for good when a page it creates sends the app on', async () => {
    assert.equal(await router.navigateByUrl('/compose/redirecting'), false);
    await idle();
    assert.equal(router.url, '/user/9');
    assert.deepEqual(stack(fabric), [
      'home',
      'start redirecting',
      'start',
      'redirecting',
      'user 9',
    ]);
    assert.equal(live['User'], 1, 'user 1 is gone, and user 9 is there');
  });
});
