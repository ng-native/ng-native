/**
 * Angular's own `animate.enter` and `animate.leave`, running on native views.
 *
 * The instruction is renderer-driven rather than DOM-driven: it adds a class through `Renderer2`,
 * listens for `transitionend` through `Renderer2`, and asks the element how long its animation
 * lasts. All three are things this project can answer, so the API works unchanged - the element
 * stays in the tree, fading, until the transition the stylesheet declared has finished.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, render, settle, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

/**
 * The engine's clock, stepped by hand rather than waited on. Sleeping for an animation's duration
 * plus a margin is what makes a suite flaky: the duration is real time and the margin is not, so a
 * loaded machine spends the margin scheduling other work.
 */
function clock() {
  let time = 1000;
  let engine: Engine | undefined;
  const handle = {
    now: () => time,
    use(on: Engine) {
      engine = on;
    },
    /** Moves time on and runs the frame it lands on, then lets `transitionend` listeners run. */
    async tick(ms: number) {
      time += ms;
      engine?.advanceAnimations();
      engine?.commit();
      await settle();
    },
  };
  clocks.push(handle);
  return handle;
}

/**
 * Every clock is run out after its test, whatever happened in it: an assertion failing
 * mid-animation would otherwise leave the frame pump rescheduling on a clock that never moves,
 * and the process would never exit.
 */
const clocks: { tick(ms: number): Promise<void> }[] = [];
afterEach(async () => {
  for (const running of clocks.splice(0)) await running.tick(1e9);
});

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(fileURLToPath(new URL('./fixtures/leave.ts', import.meta.url)));
});

after(cleanup);

describe('animate.leave', () => {
  let fabric: FakeFabric;
  let host: { shown: { set(v: boolean): void } };
  let time: ReturnType<typeof clock>;

  const panel = () => flatten(fabric.committed).find((n) => n.props['opacity'] !== undefined);

  async function boot() {
    time = clock();
    const result = await render(mod['Leaving'] as Type<{ shown: { set(v: boolean): void } }>, {
      now: time.now,
    });
    time.use(result.componentRef.injector.get(Engine));
    fabric = result.fabric;
    host = result.instance;
  }

  it('is switched on at all, which needs the animation globals in place', async () => {
    await boot();
    assert.ok(panel(), 'the panel is on screen to begin with');
    assert.equal(panel()!.props['opacity'], 1);
  });

  it('keeps the element while it fades, and removes it when the transition ends', async () => {
    await boot();
    host.shown.set(false);
    await settle();
    // The leave class arrives from Angular's animation queue after the render pass, and the first
    // frame is what commits it and starts the transition.
    await time.tick(0);

    assert.ok(panel(), 'still there: the leave class only started a transition');
    assert.equal(panel()!.props['opacity'], 1, 'and it has not jumped to the end');

    await time.tick(299);
    assert.ok(panel(), 'still there a frame before the end');
    await time.tick(1);
    // `transitionend` runs after the commit that finished the transition; the removal is the next.
    await time.tick(0);
    assert.equal(panel(), undefined, 'gone once the transition finished');
  });

  it('reaches an opacity between the two along the way', async () => {
    await boot();
    host.shown.set(false);
    await settle();
    await time.tick(0);
    await time.tick(150);

    assert.equal(panel()?.props['opacity'], 0.5, 'halfway through the linear fade');
    await time.tick(150);
  });
});

/**
 * `animate.enter` on a `@keyframes` animation, which plays from its own frames whatever the element
 * was drawn as before.
 */
describe('animate.enter', () => {
  it('plays the keyframes and holds the element until they finish', async () => {
    const time = clock();
    const { fabric, instance, componentRef } = await render(
      mod['Entering'] as Type<{ shown: { set(v: boolean): void } }>,
      { now: time.now },
    );
    time.use(componentRef.injector.get(Engine));

    instance.shown.set(true);
    await settle();
    const opacity = () =>
      flatten(fabric.committed).find((n) => n.props['opacity'] !== undefined)?.props['opacity'];

    // The enter class arrives from Angular's animation queue after the render pass, and is
    // committed in the same turn.
    await time.tick(0);
    assert.equal(opacity(), 0, 'playing from the first frame');
    await time.tick(60);
    assert.equal(opacity(), 0.2, 'a fifth of the way through');

    await time.tick(240);
    assert.equal(opacity(), 1, 'and settles on its resting style');

    const node = componentRef.injector.get(Engine).root.children[0]!.children[0]!;
    assert.equal(node.classes?.has('arriving'), false, 'with the enter class taken off again');
    cleanup();
  });
});

/**
 * `animate.enter` on a transition. On the web the element is inserted with the enter class on it,
 * so its first frame is the enter style, and Angular takes the class off a frame later, which is
 * the one change the transition runs for. Here Angular adds the class after the render pass that
 * created the element, so the class has to reach the element's first frame without being read as
 * a change from a resting style nobody saw.
 */
describe('animate.enter on a transition', () => {
  it('starts in the enter style and eases once to the resting one', async () => {
    const time = clock();
    const { fabric, instance, componentRef } = await render(
      mod['FadingIn'] as Type<{ shown: { set(v: boolean): void } }>,
      { now: time.now },
    );
    const engine = componentRef.injector.get(Engine);
    time.use(engine);
    const opacity = () =>
      flatten(fabric.committed).find((n) => n.props['opacity'] !== undefined)?.props['opacity'];
    const seen: unknown[] = [];
    const commit = fabric.completeRoot.bind(fabric);
    fabric.completeRoot = (...args: Parameters<typeof commit>) => {
      commit(...args);
      seen.push(opacity());
    };

    try {
      instance.shown.set(true);
      await settle();
      // Native mounts once a turn is over, its microtasks included, so the last commit of the
      // turn is what the first frame draws.
      assert.equal(seen.at(-1), 0, 'the enter style is what the first frame draws');
      seen.length = 0;

      // Angular takes the class off in the next frame, having found nothing running.
      const node = engine.root.children[0]!.children[0]!;
      for (let waited = 0; node.classes?.has('entering') && waited < 100; waited++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(node.classes?.has('entering'), false, 'the enter class is taken off');
      await time.tick(0);
      assert.equal(opacity(), 0, 'and the fade starts from the enter style');

      await time.tick(150);
      assert.equal(opacity(), 0.5, 'halfway through the one fade');
      await time.tick(150);
      assert.equal(opacity(), 1);
      const values = seen.filter((value): value is number => typeof value === 'number');
      assert.deepEqual(
        values,
        [...values].sort((a, b) => a - b),
        'it only ever rises',
      );
    } finally {
      // Run out whatever is still easing, or the frame pump never stops.
      await time.tick(1e9);
      await time.tick(1e9);
      cleanup();
    }
  });
});

/** A transform bound as a style eases under a transition as one a class sets does. */
describe('a bound transform under a transition', () => {
  it('eases beside the one a rule sets, and arrives with it', async () => {
    const bound = await compileFixture(
      fileURLToPath(new URL('./fixtures/bound-transform.ts', import.meta.url)),
    );
    const time = clock();
    const app = await render(bound['Slide'] as Type<{ on: { set(v: boolean): void } }>, {
      now: time.now,
    });
    time.use(app.componentRef.injector.get(Engine));
    const x = (id: string) =>
      (app.getByTestId(id).props['transform'] as [{ translateX: number }])[0].translateX;
    try {
      app.instance.on.set(true);
      await settle();
      await time.tick(150);
      assert.deepEqual([x('ruled'), x('bound')], [50, 50]);
      await time.tick(150);
      assert.deepEqual([x('ruled'), x('bound')], [100, 100]);
    } finally {
      await time.tick(1e9);
      cleanup();
    }
  });
});
