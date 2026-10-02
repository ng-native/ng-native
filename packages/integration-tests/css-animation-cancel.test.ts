/**
 * `animationcancel`, for an animation that stops before it ends.
 *
 * A browser fires it when the element stops asking for the animation, when the animation's name
 * changes (before the new one's `animationstart`), and when its `@keyframes` go away, and not for
 * one that had already ended. The sequences were recorded from Chromium with the same rules.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const CSS =
  '@keyframes a { to { opacity: 0 } } @keyframes b { to { opacity: 0.5 } } ' +
  '.a { animation: a 10s } .b { animation: b 10s } .short { animation: a 10ms } ' +
  '.scroll-b { animation: b linear both; animation-timeline: scroll() } ' +
  '.scroll-a { animation: a linear both; animation-timeline: scroll() }';

function scene(classes: string) {
  let now = 1000;
  const sheet = compileCss(CSS) as StyleSheet;
  const engine = new Engine(createFakeFabric(), 1, { now: () => now });
  const view = engine.createElement('view', sheet);
  const heard: string[] = [];
  for (const type of ['Animationstart', 'Animationend', 'Animationcancel']) {
    engine.setEventListener(view, `top${type}`, (event) => {
      heard.push(
        `${type.toLowerCase().replace('animation', '')} ${(event as { animationName: string }).animationName}`,
      );
    });
  }
  engine.setClasses(view, classes);
  engine.appendChild(engine.root, view);
  engine.commit();
  return {
    engine,
    view,
    sheet,
    heard,
    tick(ms: number) {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    },
  };
}

describe('animationcancel', () => {
  it('fires when the element stops asking for a running animation', () => {
    const { engine, view, heard } = scene('a');
    engine.setClasses(view, '');
    engine.commit();
    assert.deepEqual(heard, ['start a', 'cancel a']);
  });

  it("fires for the old animation before the new one's start when the name changes", () => {
    const { engine, view, heard } = scene('a');
    engine.setClasses(view, 'b');
    engine.commit();
    assert.deepEqual(heard, ['start a', 'cancel a', 'start b']);
  });

  it('fires when a hot swap takes the keyframes away', () => {
    // A global sheet, as a None component's is, replaced by one without them.
    const sheet = compileCss(CSS) as StyleSheet;
    const engine = new Engine(createFakeFabric(), 1, { now: () => 1000 });
    engine.addGlobalSheet(sheet);
    const view = engine.createElement('view');
    const heard: string[] = [];
    engine.setEventListener(view, 'topAnimationcancel', (event) => {
      heard.push((event as { animationName: string }).animationName);
    });
    engine.setClasses(view, 'a');
    engine.appendChild(engine.root, view);
    engine.commit();
    engine.addGlobalSheet(compileCss('.a { animation: a 10s }') as StyleSheet, sheet);
    engine.commit();
    assert.deepEqual(heard, ['a']);
  });

  it('does not fire for an animation that had already ended', () => {
    const { engine, view, heard, tick } = scene('short');
    tick(50);
    engine.setClasses(view, '');
    engine.commit();
    assert.deepEqual(heard, ['start a', 'end a']);
  });

  it('fires for a clock animation replaced by a differently named scroll-driven one', () => {
    const { engine, view, heard } = scene('a');
    engine.setClasses(view, 'scroll-b');
    engine.commit();
    assert.deepEqual(heard, ['start a', 'cancel a']);
  });
});
