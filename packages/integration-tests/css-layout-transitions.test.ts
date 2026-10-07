/**
 * CSS transitions of a box's size and place, played by native. A width cannot be eased by
 * native's animation driver: it moves other boxes, and that is layout. React Native's layout
 * animation is what does: the commit says where everything ends up, and native moves each view
 * whose frame changed there over the time it is given. So a bar that grows is the one commit,
 * where easing it from JavaScript is a commit a frame.
 *
 * It moves every frame the commit changes, and by one of four curves. So it is used where the
 * only boxes a commit resizes are the ones in transition, and JavaScript eases them otherwise.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const CSS = `
  .a { width: 10px; transition: width 200ms ease-in-out }
  .a.on { width: 30px }
  .a.straight { transition-timing-function: linear }
  .a.brief { transition-duration: 20ms }
  .b.tall { height: 40px }
  .b.red { background-color: red }
`;

function scene() {
  const fabric = createFakeFabric();
  const asked: { duration: number; update: { type: string } }[] = [];
  Object.assign(fabric, {
    configureNextLayoutAnimation: (config: (typeof asked)[number]) => void asked.push(config),
  });
  let now = 0;
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(CSS) as StyleSheet,
    now: () => now,
  });
  const make = (classes: string): EngineNode => {
    const view = engine.createElement('view');
    engine.setClasses(view, classes);
    engine.appendChild(engine.root, view);
    return view;
  };
  const a = make('a');
  const b = make('b');
  const events: string[] = [];
  for (const name of ['topTransitionstart', 'topTransitionend']) {
    engine.setEventListener(a, name, () => void events.push(name.slice(13)));
  }
  engine.commit();
  engine.advanceAnimations();
  const width = () => fabric.committed[0]!.props['width'];
  const later = (ms: number) => {
    now += ms;
    const live = engine.advanceAnimations();
    engine.commit();
    return live;
  };
  return { engine, a, b, asked, events, width, later };
}

describe('a transition of a width', () => {
  it('is the one commit, to where it ends, with native asked to move the view there', () => {
    const s = scene();
    s.engine.setClasses(s.a, 'a on');
    s.engine.commit();
    assert.deepEqual(s.asked, [{ duration: 200, update: { type: 'easeInEaseOut' } }]);
    assert.equal(s.width(), 30);
    assert.equal(s.engine.animating, false);
    assert.deepEqual(s.events, ['start']);
  });

  it('is asked for by the curve nearest its own', () => {
    const s = scene();
    s.engine.setClasses(s.a, 'a straight on');
    s.engine.commit();
    assert.equal(s.asked.at(-1)!.update.type, 'linear');
  });

  it('says it has ended when its time is up', async () => {
    const s = scene();
    s.engine.setClasses(s.a, 'a brief on');
    s.engine.commit();
    assert.deepEqual(s.events, ['start']);
    await new Promise((done) => setTimeout(done, 60));
    assert.deepEqual(s.events, ['start', 'end']);
  });

  it('is not disturbed by paint, or a prop that is no style, changing in the commit', () => {
    const s = scene();
    s.engine.setClasses(s.a, 'a on');
    s.engine.setClasses(s.b, 'b red');
    s.engine.setProp(s.b, 'accessibilityLabel', 'beside');
    s.engine.commit();
    assert.equal(s.asked.length, 1);
    assert.equal(s.width(), 30);
  });

  it('is eased from JavaScript where another box is resized in the commit', () => {
    // Native would move that one over the same time, and nothing asked for it to be moved.
    const s = scene();
    s.engine.setClasses(s.a, 'a on');
    s.engine.setClasses(s.b, 'b tall');
    s.engine.commit();
    assert.equal(s.asked.length, 0);
    assert.equal(s.width(), 10);
    assert.equal(s.engine.animating, true);
    s.later(100);
    assert.equal(s.width(), 20);
    s.later(100);
    assert.equal(s.width(), 30);
    assert.deepEqual(s.events, ['start', 'end']);
  });

  it('is sent another way from where it has got to, with native asked again', () => {
    const s = scene();
    s.engine.setClasses(s.a, 'a straight on');
    s.engine.commit();
    s.later(50);
    s.engine.setClasses(s.a, 'a straight');
    s.engine.commit();
    assert.equal(s.asked.length, 2);
    assert.equal(s.width(), 10);
    assert.equal(s.engine.animating, false);
  });

  it('is eased from JavaScript on a host with no layout animation', () => {
    const fabric = createFakeFabric();
    let now = 0;
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(CSS) as StyleSheet,
      now: () => now,
    });
    const view = engine.createElement('view');
    engine.setClasses(view, 'a straight');
    engine.appendChild(engine.root, view);
    engine.commit();
    engine.advanceAnimations();
    engine.setClasses(view, 'a straight on');
    engine.commit();
    assert.equal(engine.animating, true);
    now += 100;
    engine.advanceAnimations();
    engine.commit();
    assert.equal(fabric.committed[0]!.props['width'], 20);
  });
});
