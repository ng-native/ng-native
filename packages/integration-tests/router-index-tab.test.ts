/**
 * A tab bar at the root whose first tab is at path `''`, so its url is `/` and every page inside
 * it is a url at the root too, beside pages that are not in the bar at all.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, withComponentInputBinding, type Routes } from '@angular/router';
import { DeepLinks } from '@ng-native/device';
import {
  cleanup,
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

describe('a tab at path ""', () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let nav: NativeNavigation;
  let fabric: FakeFabric;
  let created: Record<string, number>;
  let live: Record<string, number>;
  let provenance = 0;

  const host = () => flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
  const selected = () =>
    (host().props['navStateRequest'] as { selectedScreenKey: string }).selectedScreenKey;
  const tap = async (key: string) => {
    await fireEvent(host(), 'tabSelected', { selectedScreenKey: key, provenance: ++provenance });
    await idle();
  };
  /** What the screens of the app's own stack say, bottom first. */
  const appStack = () =>
    fabric.committed[0]!.children[0]!.children.map((screen) =>
      flatten(screen.children)
        .map((node) => node.props['text'])
        .filter((text) => typeof text === 'string')
        .join(' '),
    );

  before(async () => {
    mod = await compileFixture('fixtures/index-tab.ts');
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
    await idle();
    assert.equal(router.url, '/');
    assert.equal(selected(), '/');
  });

  afterEach(() => cleanup());

  it('gives the tab a screen key iOS reads as one, since it reads an empty key as none', () => {
    const keys = host().children.map((screen) => screen.props['screenKey']);
    assert.ok(keys.includes('/'), `the tab's screen key, among ${JSON.stringify(keys)}`);
    assert.ok(!keys.includes(''));
  });

  it('presents a page of it from another tab over that tab, and back returns there', async () => {
    await tap('schedule');
    assert.equal(await nav.present('/talks/7', { as: 'formSheet' }), true);
    await idle();
    assert.equal(router.url, '/schedule(presented:talks/7)');
    assert.equal(selected(), 'schedule');
    assert.equal(created['HomeStack'], 1, 'the first tab is not built again');

    nav.back();
    await idle();
    assert.equal(router.url, '/schedule');
    assert.equal(live['Talk'], 0);
    assert.equal(created['HomeStack'], 1);
  });

  it('pushes a page of it from another tab onto the stack it already has', async () => {
    await tap('schedule');
    await nav.push('/talks/7');
    await idle();
    assert.equal(router.url, '/talks/7');
    assert.equal(selected(), '/');
    assert.equal(created['HomeStack'], 1, 'one stack in the tab, not a second');
    assert.equal(live['HomeStack'], 1);

    nav.back();
    await idle();
    assert.equal(router.url, '/');
  });

  it('returns to the page it was left on', async () => {
    await nav.push('/talks/7');
    await idle();
    await tap('schedule');
    await tap('/');
    assert.equal(router.url, '/talks/7');
  });

  it('leaves a page outside the bar to the app stack', async () => {
    await tap('schedule');
    await nav.present('/user/1', { as: 'formSheet' });
    await idle();
    assert.equal(router.url, '/user/1', 'presented where its url puts it, not as a page of a tab');
    assert.deepEqual(appStack().at(-1), 'user 1');

    nav.back();
    await idle();
    assert.equal(router.url, '/schedule');
  });
});

describe('a tab at path "" not yet opened', () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let nav: NativeNavigation;
  let fabric: FakeFabric;

  /** What each screen says, bottom first, across every stack. */
  const screens = () =>
    flatten(fabric.committed)
      .filter((node) => node.viewName === 'RNSScreen')
      .map((screen) =>
        flatten(screen.children)
          .filter((node) => node.viewName !== 'RNSScreen')
          .map((node) => node.props['text'])
          .filter((text) => typeof text === 'string')
          .join(' '),
      )
      .filter(Boolean);

  before(async () => {
    mod = await compileFixture('fixtures/index-tab.ts');
  });

  /** Launched on the second tab by a link, so the first has never been opened. */
  beforeEach(async () => {
    const links = { initialUrl: () => '/schedule', subscribe: () => () => {} };
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['routes'] as Routes, withComponentInputBinding()),
        { provide: DeepLinks, useValue: links },
      ],
    });
    fabric = app.fabric;
    router = app.componentRef.injector.get(Router);
    nav = app.componentRef.injector.get(NativeNavigation);
    await idle();
    assert.equal(router.url, '/schedule');
  });

  afterEach(() => cleanup());

  it("pushes a page of it over the tab's own first screen, and back lands there", async () => {
    await nav.push('/talks/7');
    await idle();
    assert.equal(router.url, '/talks/7');
    assert.ok(screens().includes('home'), 'the tab opened on its first screen under the page');

    nav.back();
    await idle();
    assert.equal(router.url, '/');
  });

  it('leaves a page outside the bar alone, though a lazy parameter of the tab could match it', async () => {
    cleanup();
    const links = { initialUrl: () => '/schedule', subscribe: () => () => {} };
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['routesWithTopics'] as Routes, withComponentInputBinding()),
        { provide: DeepLinks, useValue: links },
      ],
    });
    router = app.componentRef.injector.get(Router);
    nav = app.componentRef.injector.get(NativeNavigation);
    await idle();
    assert.equal(router.url, '/schedule');

    await nav.push('/user/1');
    await idle();
    assert.equal(router.url, '/user/1');

    nav.back();
    await idle();
    assert.equal(router.url, '/schedule', 'back where the push came from, not the first tab');
  });
});
