/**
 * Motion off: what a test asks for so what it reads, or captures, is where each change ends. Every
 * transition and `@keyframes` animation takes no time, as CSS defines one of no duration: a
 * transition lands on its new value, an animation ends by the next frame, keeping its last frame
 * only where its fill mode says so, and one that repeats forever shows the resting style.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

import { Engine } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

const css = `
  @keyframes rise {
    from { opacity: 0; width: 10px; }
    to { opacity: 0.5; width: 50px; }
  }
  view { opacity: 1; width: 100px; transition: opacity 300ms linear 50ms; }
  view.faded { opacity: 0; }
  view.held { animation: rise 1s linear 200ms 1 forwards; }
  view.played { animation: rise 1s linear; }
  view.spinning { animation: rise 1s linear infinite; }
  view.played.paused { animation-play-state: paused; }
`;

function scene(motion?: 'on' | 'off') {
  let now = 1000;
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css) as never,
    now: () => now,
    ...(motion && { motion }),
  });
  const view = engine.createElement('view');
  engine.appendChild(engine.root, view);
  engine.commit();
  return {
    engine,
    painted: (prop: string) => flatten(fabric.committed)[0]?.props[prop],
    classes(value: string) {
      engine.setClasses(view, value);
      engine.commit();
    },
    tick(ms: number) {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    },
  };
}

describe('motion off', () => {
  it('lands a transition on its new value at once, its delay too', () => {
    const s = scene('off');
    s.classes('faded');
    assert.equal(s.painted('opacity'), 0);
  });

  it('ends a finite animation at once, on its last frame where it fills forwards', () => {
    const s = scene('off');
    s.classes('held');
    assert.equal(s.painted('width'), 50);
    assert.equal(s.painted('opacity'), 0.5);
  });

  it('ends a finite animation by the next frame, on the resting style where it does not fill', () => {
    const s = scene('off');
    s.classes('played');
    // Played, if for no time: it starts and ends, so what waits for animationend (Angular's
    // animate.leave) still goes on.
    s.tick(0);
    assert.equal(s.painted('width'), 100);
  });

  it('ends a paused finite animation too, rather than holding it', () => {
    const s = scene('off');
    s.classes('played paused');
    s.tick(0);
    assert.equal(s.painted('width'), 100);
  });

  it('shows the resting style for an animation that repeats forever', () => {
    const s = scene('off');
    s.classes('spinning');
    assert.equal(s.painted('width'), 100);
    s.tick(400);
    assert.equal(s.painted('width'), 100, 'and stays there');
  });

  it('plays again once motion is back on, and from the start with it on', () => {
    const s = scene('off');
    s.engine.setMotion('on');
    s.classes('faded');
    s.tick(200);
    assert.equal(s.painted('opacity'), 0.5, 'half way, after its 50ms delay');
    const on = scene();
    on.classes('played');
    on.tick(500);
    assert.equal(on.painted('width'), 30, 'the default is motion on');
  });

  it('turns off while running: the next change lands at once', () => {
    const s = scene();
    s.engine.setMotion('off');
    s.classes('faded');
    assert.equal(s.painted('opacity'), 0);
  });
});
