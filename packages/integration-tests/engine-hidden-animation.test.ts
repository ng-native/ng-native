/**
 * An endless `@keyframes` animation on an element that is `display: none`, or under one, stops:
 * it paints nothing, and would otherwise keep the frame loop running, with a native commit a
 * frame where the hidden element is the animated one.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

const CSS =
  '@keyframes spin { from { opacity: 0 } to { opacity: 1 } } ' +
  '.spin { animation: spin 1s linear infinite } .hidden { display: none }';

function scene() {
  let time = 0;
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(CSS, 'app.css') as StyleSheet,
    now: () => time,
  });
  const box = engine.createElement('view');
  engine.appendChild(engine.root, box);
  const spinner = engine.createElement('view');
  engine.setClasses(spinner, 'spin');
  engine.appendChild(box, spinner);
  engine.commit();
  /** One frame of the platform's loop: advance, then commit what that marked. */
  const frame = () => {
    time += 16;
    const animating = engine.advanceAnimations(time);
    const before = fabric.calls.completeRoot;
    engine.commit();
    return { animating, commits: fabric.calls.completeRoot - before };
  };
  return { engine, fabric, box, spinner, frame };
}

describe('an endless animation on an element that is not displayed', () => {
  it('control: plays while it is displayed', () => {
    const s = scene();
    assert.deepEqual(s.frame(), { animating: true, commits: 1 });
  });

  it('commits nothing a frame once the element itself is display: none', () => {
    const s = scene();
    s.frame();
    s.engine.addClass(s.spinner, 'hidden');
    s.engine.commit();
    assert.equal(s.fabric.render(), 'View');
    s.frame();
    assert.equal(s.frame().commits, 0, 'a commit a frame for a view that is not there');
  });

  it('sends animationcancel once, as a browser does for display: none', () => {
    const s = scene();
    const heard: string[] = [];
    s.engine.setEventListener(s.spinner, 'topAnimationcancel', (event) => {
      heard.push((event as { animationName: string }).animationName);
    });
    s.frame();
    s.engine.addClass(s.spinner, 'hidden');
    s.engine.commit();
    s.frame();
    s.frame();
    assert.deepEqual(heard, ['spin']);
  });

  it('stops asking for frames once the element itself is display: none', () => {
    const s = scene();
    s.frame();
    s.engine.addClass(s.spinner, 'hidden');
    s.engine.commit();
    assert.equal(s.frame().animating, false, 'from the first frame it is hidden');
  });

  it('stops asking for frames under a box that is display: none', () => {
    const s = scene();
    s.frame();
    s.engine.addClass(s.box, 'hidden');
    s.engine.commit();
    s.frame();
    assert.equal(s.frame().animating, false);
  });

  it('stops asking for frames when the animation is taken off it while it is hidden', () => {
    const s = scene();
    s.frame();
    s.engine.addClass(s.box, 'hidden');
    s.engine.commit();
    s.engine.setClasses(s.spinner, '');
    s.engine.commit();
    s.frame();
    assert.equal(s.frame().animating, false);
  });

  for (const on of ['spinner', 'box'] as const) {
    it(`plays again when the ${on} it was hidden by is shown`, () => {
      const s = scene();
      s.frame();
      s.engine.addClass(s[on], 'hidden');
      s.engine.commit();
      s.frame();
      s.engine.removeClass(s[on], 'hidden');
      s.engine.commit();
      assert.deepEqual(s.frame(), { animating: true, commits: 1 });
    });
  }
});
