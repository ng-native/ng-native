/**
 * Which commit a configured layout animation lands on.
 *
 * Native plays it on the next commit that changes anything, whatever made that commit. The engine
 * commits a frame of a JavaScript-driven animation from `requestAnimationFrame`, outside change
 * detection, so a frame that arrives after `animate()` configured and before the change's own
 * commit would take the animation and leave the change to land in one step.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import { LayoutAnimation, type NativeLayoutAnimation } from '@ng-native/device';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Fixture {
  wide: { (): boolean; set(value: boolean): void };
  toggle(change?: () => void): Promise<void>;
  toggleInPass(): void;
}

interface Scene {
  instance: Fixture;
  order: string[];
  /** A frame arrives: every callback waiting on one runs. */
  frame(): void;
  frames: unknown[];
  /** A change-detection pass, run now. */
  pass(): void;
}

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the commit a layout animation lands on', () => {
  let Component: Type<Fixture>;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/layout-animated.ts', import.meta.url)),
    );
    Component = mod['LayoutAnimated'] as Type<Fixture>;
  });

  /** The fixture mounted, with frames that arrive when the test says and a record of the order. */
  async function scene(run: (scene: Scene) => Promise<void>): Promise<void> {
    const scope = globalThis as { requestAnimationFrame?: unknown };
    const real = scope.requestAnimationFrame;
    const frames: ((time: number) => void)[] = [];
    scope.requestAnimationFrame = (callback: (time: number) => void) => frames.push(callback);

    const order: string[] = [];
    const fabric = createFakeFabric();
    const find = (id: string) => {
      const walk = (nodes: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
        for (const node of nodes) {
          if (node.props['nativeID'] === id) return node;
          const inside = walk(node.children);
          if (inside) return inside;
        }
        return undefined;
      };
      return walk(fabric.committed);
    };
    const complete = fabric.completeRoot.bind(fabric);
    fabric.completeRoot = (...args: Parameters<typeof complete>) => {
      complete(...args);
      order.push(`commit, bar ${String(find('bar')?.props['width'])}`);
    };
    const native: NativeLayoutAnimation = {
      configureNext: (_config, done) => {
        order.push('configure');
        done?.();
      },
    };
    const app = mount(1, Component, fabric, {
      providers: [{ provide: LayoutAnimation.SOURCE, useValue: native }],
    });
    try {
      await settle();
      const frame = () => {
        for (const callback of frames.splice(0)) callback(Date.now());
      };
      await run({
        instance: app.componentRef.instance as Fixture,
        order,
        frame,
        frames,
        pass: () => app.applicationRef.tick(),
      });
    } finally {
      app.applicationRef.destroy();
      if (real === undefined) delete scope.requestAnimationFrame;
      else scope.requestAnimationFrame = real;
    }
  }

  it('is the commit of the change, with a frame of another animation arriving right after', async () => {
    await scene(async ({ instance, order, frame, frames }) => {
      // The other animation is playing: it has a frame waiting, and time for it to have moved.
      frame();
      await settle(20);
      assert.ok(frames.length > 0, 'the animation waits on a frame');
      order.length = 0;

      void instance.toggle();
      frame();
      await settle(40);

      assert.deepEqual(order.slice(0, 2), ['configure', 'commit, bar 300']);
    });
  });

  it('is not a later commit when the change commits nothing', async () => {
    await scene(async ({ instance, order, frame }) => {
      frame();
      await settle(20);
      order.length = 0;

      await instance.toggle(() => {});
      // Something else changes afterwards, with no animation asked for.
      instance.wide.set(true);
      frame();
      await settle(40);

      assert.ok(order.includes('commit, bar 300'), 'the later change commits');
      assert.ok(!order.includes('configure'), `nothing was configured: ${order.join(' | ')}`);
    });
  });

  it('is no commit at all when the change throws, however soon the next one comes', async () => {
    await scene(async ({ instance, order, pass }) => {
      order.length = 0;
      const failed = instance.toggle(() => {
        throw new Error('no change');
      });
      // In the same turn, before anything queued can run.
      instance.wide.set(true);
      pass();

      await assert.rejects(failed, /no change/);
      assert.deepEqual(order, ['commit, bar 300']);
    });
  });

  it('resolves a change that committed nothing when another is animated in the same turn', async () => {
    await scene(async ({ instance, order }) => {
      order.length = 0;
      const nothing = instance.toggle(() => {});
      const something = instance.toggle();
      await Promise.all([nothing, something]);

      assert.deepEqual(order, ['configure', 'commit, bar 300']);
    });
  });

  it('configures once for a change made inside a change-detection pass, as that pass commits', async () => {
    await scene(async ({ instance, order }) => {
      order.length = 0;
      instance.toggleInPass();
      await settle(40);

      assert.deepEqual(order, ['configure', 'commit, bar 300']);
    });
  });
});

describe("the engine's word before a commit", () => {
  function scene() {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {});
    const view = engine.createElement('view');
    engine.appendChild(engine.root, view);
    engine.commit();
    const order: string[] = [];
    const complete = fabric.completeRoot.bind(fabric);
    fabric.completeRoot = (...args: Parameters<typeof complete>) => {
      order.push('commit');
      complete(...args);
    };
    return { engine, view, order };
  }

  it('is given once, before the host has the tree, and not for the commit after', () => {
    const { engine, view, order } = scene();
    engine.beforeNextCommit(() => order.push('before'));
    engine.setProp(view, 'opacity', 0.5);
    engine.commit();
    engine.setProp(view, 'opacity', 1);
    engine.commit();
    assert.deepEqual(order, ['before', 'commit', 'commit']);
  });

  it('waits through a pass that commits nothing, and can be taken back', () => {
    const { engine, view, order } = scene();
    const withdraw = engine.beforeNextCommit(() => order.push('before'));
    assert.equal(engine.commit(), false);
    assert.deepEqual(order, []);
    withdraw();
    engine.setProp(view, 'opacity', 0.5);
    engine.commit();
    assert.deepEqual(order, ['commit']);
  });

  it('leaves a later request alone when an earlier one is taken back', () => {
    const { engine, view, order } = scene();
    const withdraw = engine.beforeNextCommit(() => order.push('first'));
    engine.beforeNextCommit(() => order.push('second'));
    withdraw();
    engine.setProp(view, 'opacity', 0.5);
    engine.commit();
    assert.deepEqual(order, ['second', 'commit']);
  });
});
