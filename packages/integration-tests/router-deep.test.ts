/**
 * Deep stacks: five screens and more, left by popping several at once, going straight back to the
 * root, and arriving by a deep link.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, withComponentInputBinding, type Routes } from '@angular/router';
import { cleanup, render, settle, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { DeepLinks } from '@ng-native/device';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter, withLinkParent } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

const stack = (fabric: FakeFabric) =>
  flatten(fabric.committed)
    .filter((node) => node.viewName === 'RNSScreen')
    .map((screen) =>
      flatten(screen.children)
        .map((node) => node.props['text'])
        .filter((text) => typeof text === 'string')
        .join(' '),
    );

let mod: Record<string, unknown>;
let created: Record<string, number>;
before(async () => {
  mod = await compileFixture('fixtures/stack-app.ts');
  created = mod['created'] as Record<string, number>;
});

async function boot(launch: string | null = null) {
  cleanup();
  for (const key of Object.keys(created)) delete created[key];
  // Each user sits under the one before it, and the first under home.
  const parentOf = (url: string) => {
    const id = Number(/^\/user\/(\d+)$/.exec(url)?.[1]);
    if (!id) return null;
    return id > 1 ? `/user/${id - 1}` : '/';
  };
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [
      provideNativeRouter(
        mod['routes'] as Routes,
        withComponentInputBinding(),
        withLinkParent(parentOf),
      ),
      {
        provide: DeepLinks.SOURCE,
        useValue: {
          launchUrl: () => Promise.resolve(launch ? `canary://${launch.slice(1)}` : null),
          subscribe: () => () => {},
          open: () => {},
        },
      },
    ],
  });
  await idle();
  return {
    fabric: app.fabric,
    router: app.componentRef.injector.get(Router),
    nav: app.componentRef.injector.get(NativeNavigation),
  };
}

describe('a deep stack', () => {
  let fabric: FakeFabric;
  let router: Router;
  let nav: NativeNavigation;

  beforeEach(async () => {
    ({ fabric, router, nav } = await boot());
    for (let id = 1; id <= 5; id++) {
      await nav.push(`/user/${id}`);
      await idle();
    }
  });

  it('holds six screens', () => {
    assert.deepEqual(stack(fabric), ['home', 'user 1', 'user 2', 'user 3', 'user 4', 'user 5']);
  });

  it('pops several screens at once to one further down', async () => {
    await nav.popTo('/user/2');
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'user 1', 'user 2']);
    assert.equal(created['User'], 5, 'user 2 is the screen that was there, not a new one');
    assert.equal(router.url, '/user/2');
  });

  it('pops to an earlier screen showing the url of the one on top', async () => {
    // A customer, one of its jobs, the customer again: the same url twice on one stack.
    await nav.push('/user/2');
    await idle();
    assert.equal(stack(fabric).length, 7);

    const popped = await Promise.race([
      nav.popTo('/user/2'),
      new Promise<'never'>((resolve) => setTimeout(() => resolve('never'), 500)),
    ]);
    await idle();
    assert.equal(popped, true);
    assert.deepEqual(stack(fabric), ['home', 'user 1', 'user 2']);
    assert.equal(router.url, '/user/2');

    nav.back();
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'user 1'], 'and goes back from there');
    assert.equal(router.url, '/user/1');
  });

  it('pops straight to the root, keeping the root screen', async () => {
    await nav.popToRoot();
    await idle();
    assert.deepEqual(stack(fabric), ['home']);
    assert.equal(router.url, '/');
  });

  it('goes back one screen at a time from where it popped to', async () => {
    await nav.popTo('/user/2');
    await idle();
    nav.back();
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'user 1']);
    assert.equal(router.url, '/user/1');
  });

  it('pushes a new screen when the url asked to pop to is not on the stack', async () => {
    assert.equal(await nav.popTo('/user/9'), false, 'nothing to pop to, so nothing happens');
    await idle();
    assert.equal(stack(fabric).length, 6);
  });
});

describe('a deep link into a nested screen', () => {
  it('opens on the whole chain of screens it belongs under, so Back retraces it', async () => {
    const { fabric, nav, router } = await boot('/user/3');
    await idle();
    assert.deepEqual(stack(fabric), ['home', 'user 1', 'user 2', 'user 3']);
    nav.back();
    await idle();
    assert.equal(router.url, '/user/2');
  });
});
