/**
 * A stack committed with its first screen, never empty (#1401).
 *
 * `RNSScreenStack` starts with a placeholder view controller so that a large title on its first
 * screen opens expanded, and react-native-screens' own JavaScript mounts the stack and that screen
 * together. Mounted empty, the stack is laid out on iOS with the placeholder's compact bar, the
 * root screen's scroll view takes its insets from that, and its large title shows collapsed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { mount } from '@ng-native/platform';
import { createFakeFabric, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

const mod = await compileFixture('fixtures/stack-first-screen.ts');

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/** Each commit's stack: its tag and how many screens it holds, or null with no stack. */
async function stacksCommitted(routes: string, then?: (router: Router) => Promise<void>) {
  const fabric = createFakeFabric();
  const seen: ({ tag: number; screens: number } | null)[] = [];
  const commit = fabric.completeRoot.bind(fabric);
  fabric.completeRoot = (rootTag, set) => {
    commit(rootTag, set);
    const stack = flatten(set as FakeFabricNode[]).find((n) => n.viewName === 'RNSScreenStack');
    seen.push(
      stack
        ? {
            tag: stack.reactTag,
            screens: stack.children.filter((n) => n.viewName === 'RNSScreen').length,
          }
        : null,
    );
  };
  const app = mount(1, mod['Shell'] as Type<unknown>, fabric, {
    providers: [provideNativeRouter(mod[routes] as Routes)],
  });
  try {
    await settle();
    await then?.(app.componentRef.injector.get(Router));
    return seen;
  } finally {
    app.applicationRef.destroy();
  }
}

describe('a stack and its first screen', () => {
  for (const routes of ['routes', 'lazyRoutes']) {
    it(`are committed together, for ${routes === 'routes' ? 'a root page' : 'a lazy root page'}`, async () => {
      const seen = await stacksCommitted(routes);
      const stacks = seen.filter((stack) => stack !== null);
      assert.ok(stacks.length > 0, 'the stack is committed');
      assert.deepEqual(
        stacks.filter((stack) => stack.screens === 0),
        [],
        'no commit has the stack without a screen',
      );
    });
  }

  it('keep the stack committed, as the same view, through a push and a pop', async () => {
    const seen = await stacksCommitted('routes', async (router) => {
      await router.navigateByUrl('/detail');
      await settle();
      await router.navigateByUrl('/');
      await settle();
    });
    const first = seen.findIndex((stack) => stack !== null);
    const after = seen.slice(first);
    assert.ok(
      after.every((stack) => stack !== null),
      'never withheld again',
    );
    assert.deepEqual(new Set(after.map((stack) => stack.tag)).size, 1, 'never made again');
    assert.ok(
      after.some((stack) => stack.screens === 2),
      'the push is committed',
    );
    assert.equal(after.at(-1)!.screens, 1, 'and the pop');
  });
});
