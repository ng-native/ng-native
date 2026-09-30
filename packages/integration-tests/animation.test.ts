/**
 * The Angular equivalent of `createAnimatedComponent`.
 *
 * The graph itself is React Native's and is not retested here; what matters at this seam is that
 * the element gets the values, that the native driver is handed a react tag whether or not a
 * frame ever runs in JavaScript, and that a JavaScript frame reaches the device without waiting
 * for change detection.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { ANIMATION, type AnimatedPropsHandle } from '../components/src/animation.ts';
import { compileFixture } from './compile.ts';

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

after(cleanup);

/** Stands in for `AnimatedProps`, and records what the directive asked of it. */
class FakeProps implements AnimatedPropsHandle {
  attached = 0;
  detached = 0;
  connectedTo: number | null = null;
  values: Record<string, unknown>;
  readonly frame: () => void;

  constructor(style: Record<string, unknown>, onFrame: () => void) {
    this.values = { ...style };
    this.frame = onFrame;
  }

  attach(): void {
    this.attached++;
  }
  detach(): void {
    this.detached++;
  }
  read(): Record<string, unknown> {
    return this.values;
  }
  connect(tag: number): void {
    this.connectedTo = tag;
  }
  /** What React Native does when a JavaScript-driven animation advances. */
  advance(values: Record<string, unknown>): void {
    this.values = values;
    this.frame();
  }
}

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(fileURLToPath(new URL('./fixtures/animation.ts', import.meta.url)));
});

async function boot() {
  const made: FakeProps[] = [];
  const result = await render(
    mod['Fading'] as Type<{ style: { set(value: Record<string, unknown>): void } }>,
    {
      providers: [
        {
          provide: ANIMATION,
          useValue: {
            props: (style: Record<string, unknown>, onFrame: () => void) => {
              const props = new FakeProps(style, onFrame);
              made.push(props);
              return props;
            },
          },
        },
      ],
    },
  );
  // Fabric clones on write, so the node has to be looked up again after every commit.
  const animated = () =>
    flatten(result.fabric.committed).find((n) => n.props['backgroundColor'] === 'red')!;
  return { ...result, made, animated };
}

describe('animated style', () => {
  it('writes the starting values, keeping the style already on the element', async () => {
    const { animated } = await boot();
    assert.equal(animated().props['opacity'], 1, 'the animated value');
    assert.equal(animated().props['flex'], 1, "and the template's style around it");
  });

  it('hands the native driver a react tag with no frame ever running', async () => {
    const { made, animated, componentRef } = await boot();
    assert.equal(made[0]!.attached, 1);
    assert.equal(
      made[0]!.connectedTo,
      componentRef.injector.get(Engine).tagOf(animated().instanceHandle as never),
      'the tag of the element the directive sits on',
    );
  });

  it('commits a JavaScript frame without waiting for change detection', async () => {
    const { fabric, made, animated } = await boot();
    const before = fabric.calls.completeRoot;

    made[0]!.advance({ opacity: 0.25 });

    assert.equal(animated().props['opacity'], 0.25, 'the frame reached the device');
    assert.equal(
      fabric.calls.completeRoot,
      before + 1,
      'on its own commit, not on the next render',
    );
  });

  it('rebuilds and detaches when the bound style is replaced', async () => {
    const { instance, made, rerender } = await boot();

    instance.style.set({ opacity: 0.5 });
    await rerender();

    assert.equal(made.length, 2, 'a new graph for the new style');
    assert.equal(made[0]!.detached, 1, 'and the old one released');
  });

  it('detaches when the element goes away', async () => {
    const { unmount, made } = await boot();
    unmount();
    await settle();
    assert.equal(made[0]!.detached, 1);
  });
});

/**
 * The same animation an app writes: in the component's own stylesheet, on an element carrying the
 * class from creation rather than gaining it later.
 */
describe('a keyframe animation from a component stylesheet', () => {
  it('runs on an element that had the class from the start', async (t) => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/animation.ts', import.meta.url)),
    );
    // The engine's clock, stepped by hand, so every frame is sampled at a known time however
    // slow the machine running the test.
    let now = 1000;
    const { getByTestId, componentRef, unmount } = await render(mod['Pulsing'] as Type<unknown>, {
      now: () => now,
    });
    const engine = componentRef.injector.get(Engine);
    const pulse = () => getByTestId('pulse').props['opacity'];
    const tick = (ms: number) => {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    };
    // Run out the clock whatever happens: an assertion failing mid-animation would otherwise
    // leave the frame pump rescheduling on a clock that never moves, and the process never exits.
    t.after(() => tick(1e9));

    assert.equal(pulse(), 0.25, 'the first frame is painted, not the resting style');
    assert.equal(engine.animating, true, 'and the engine knows it has frames to run');

    tick(25);
    assert.equal(pulse(), 0.4375, 'a quarter of the way through the first iteration');
    tick(100);
    assert.equal(pulse(), 0.4375, 'and of the second');
    tick(100);
    assert.equal(engine.animating, false, 'done after two iterations');
    assert.equal(pulse(), null, 'the animated value cleared, back to the resting style');

    unmount();
  });
});
