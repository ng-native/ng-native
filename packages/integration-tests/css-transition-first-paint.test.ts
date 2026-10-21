/**
 * A style settled before a view has been drawn starts no transition. A browser computes no style
 * for an element before the frame after it was inserted, so a class added before then, in the
 * same task or a later one, is where the element starts rather than a change from a style nobody
 * saw. Once a frame has drawn it, a change eases as usual.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

const BLACK = 'rgb(0, 0, 0)';
const FILLED = 'rgb(200, 100, 0)';
const HALFWAY = 'rgba(100, 50, 0, 1)';

interface Panel {
  shown: { set(v: boolean): void };
  filled: { set(v: boolean): void };
}

/**
 * The frames the platform asks for, drawn only when a test says so. Left to Node's 16ms timer, a
 * frame on a busy machine lands before the next pass and draws the view the first test needs
 * undrawn, and the timer a test waits on races the one the platform asked for.
 */
const scope = globalThis as { requestAnimationFrame?: unknown };
const real = scope.requestAnimationFrame;
let frames: FrameRequestCallback[] = [];
/** Draws the frames asked for so far, as one frame. */
const frame = () => {
  const drawn = frames;
  frames = [];
  for (const callback of drawn) callback(0);
};
/** A turn of its own, before any frame is drawn. */
const task = () => new Promise((resolve) => setTimeout(resolve, 0));

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/first-paint.ts');
  scope.requestAnimationFrame = (callback: FrameRequestCallback) => frames.push(callback);
});
after(() => {
  cleanup();
  if (real === undefined) delete scope.requestAnimationFrame;
  else scope.requestAnimationFrame = real;
});

async function boot() {
  let time = 1000;
  const { fabric, instance, componentRef } = await render(mod['BoundClassPanel'] as Type<Panel>, {
    now: () => time,
  });
  const engine = componentRef.injector.get(Engine);
  const painted = () =>
    flatten(fabric.committed).find((n) => n.props['backgroundColor'] !== undefined)?.props[
      'backgroundColor'
    ];
  // The screen the panel is added to has been drawn.
  frame();
  return {
    engine,
    instance,
    painted,
    /** Moves the clock on and runs the frame it lands on. */
    tick(ms: number) {
      time += ms;
      engine.advanceAnimations();
      engine.commit();
    },
  };
}

describe('a transition before the first frame', () => {
  it('does not ease a class added in the next pass, before a frame has drawn the view', async () => {
    const s = await boot();
    try {
      s.instance.shown.set(true);
      await task();
      assert.equal(s.painted(), BLACK, 'committed once without the class');
      s.instance.filled.set(true);
      await settle();
      assert.equal(s.engine.animating, false, 'nothing eases toward the class');
      assert.equal(s.painted(), FILLED, 'which is where the view starts');
    } finally {
      s.tick(1e9);
      cleanup();
      frames = [];
    }
  });

  it('eases a class added once a frame has drawn the view', async () => {
    const s = await boot();
    try {
      s.instance.shown.set(true);
      await task();
      frame();
      s.instance.filled.set(true);
      await settle();
      assert.equal(s.engine.animating, true);
      s.tick(100);
      assert.equal(s.painted(), HALFWAY);
    } finally {
      s.tick(1e9);
      cleanup();
      frames = [];
    }
  });

  it('eases each later change of a view already drawn', async () => {
    const s = await boot();
    try {
      s.instance.shown.set(true);
      await task();
      frame();
      s.instance.filled.set(true);
      await settle();
      s.tick(200);
      assert.equal(s.painted(), FILLED);

      s.instance.filled.set(false);
      await settle();
      s.tick(100);
      assert.equal(s.painted(), HALFWAY, 'and back again');
    } finally {
      s.tick(1e9);
      cleanup();
      frames = [];
    }
  });
});
