/**
 * A view's transform or opacity changed after a native animation has let it go. Once a graph of
 * React Native's animated module has set either on a view, no commit changes it again: iOS skips
 * both for good (`propKeysManagedByAnimated`), and Android puts the graph's last value back over
 * each commit (`overrideBySynchronousMountPropsAtMountingAndroid`). A later change is set on
 * native, through a graph that plays nothing, as well as committed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';
import { recorder } from './native-animated.ts';

const CSS = `
  @keyframes out { from { opacity: 1 } to { opacity: 0 } }
  .fade { opacity: 1; transition: opacity 200ms linear }
  .fade.gone { opacity: 0 }
  .fade.still { opacity: 0.5; transition: none }
  .half { opacity: 0.5 }
  .slide { transform: translateX(0px); transition: transform 200ms linear }
  .slide.moved { transform: translateX(40px) }
  .turned { transform: rotate(90deg) }
  .across { transform: translateX(-50%) }
  .leaves { animation: out 200ms linear }
`;

function scene(classes: string) {
  const rec = recorder();
  const fabric = createFakeFabric();
  fabric.frames.set('View', { x: 0, y: 0, width: 200, height: 100 });
  let now = 0;
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(CSS) as StyleSheet,
    nativeAnimated: rec.native,
    now: () => now,
  });
  const view = engine.createElement('view');
  engine.setClasses(view, classes);
  engine.appendChild(engine.root, view);
  engine.commit();
  // Seen once, as a view on screen has been: what comes after is a change to it.
  engine.advanceAnimations();
  const classesTo = (names: string) => {
    engine.setClasses(view, names);
    engine.commit();
  };
  const started = () => rec.named('start').map(([, id]) => id as number);
  /** What a graph that plays nothing sets on the view. */
  const set = () => rec.painted(engine.tagOf(view));
  const props = () => fabric.committed[0]!.props;
  const later = (ms: number) => {
    now += ms;
    engine.advanceAnimations();
    engine.commit();
  };
  return { engine, view, rec, classesTo, started, set, props, later, finish: rec.finish };
}

describe('a view a native animation has let go', () => {
  it('has a later opacity set on native, after a transition native played', () => {
    const s = scene('fade');
    s.classesTo('fade gone');
    s.finish(s.started()[0]!);
    assert.deepEqual(s.set(), {}, 'nothing to set where the transition ended');
    s.classesTo('half');
    assert.deepEqual(s.set(), { opacity: 0.5 });
    assert.equal(s.props()['opacity'], 0.5, 'and committed, for the shadow node');
    s.classesTo('');
    assert.deepEqual(s.set(), { opacity: 1 }, 'and one that goes is the initial value');
  });

  it('has the style a keyframes animation rests at set on native when it ends', () => {
    // It fades out and does not fill: the view is drawn as it rests, not at its last frame.
    const s = scene('leaves');
    s.finish(s.started()[0]!);
    assert.deepEqual(s.set(), { opacity: 1 });
  });

  it('has a later transform set on native, in radians and in points of its box', () => {
    const s = scene('slide');
    s.classesTo('slide moved');
    s.finish(s.started()[0]!);
    s.classesTo('turned');
    assert.deepEqual(s.set(), { transform: [{ rotate: Math.PI / 2 }] });
    s.classesTo('across');
    assert.deepEqual(s.set(), { transform: [{ translateX: -100 }] });
  });

  it('sets nothing while an animation of the prop plays, and lets go when one starts', () => {
    const s = scene('fade');
    s.classesTo('fade gone');
    s.finish(s.started()[0]!);
    s.classesTo('fade still');
    assert.deepEqual(s.set(), { opacity: 0.5 });
    const tag = s.engine.tagOf(s.view);
    assert.equal(s.rec.connected().get(tag)!.length, 1);
    // An animation of the opacity: native plays it, and the graph that set it lets go.
    const sets = s.rec.named('set').length;
    s.classesTo('fade still leaves');
    assert.equal(s.started().length, 2);
    const connected = s.rec.connected().get(tag)!;
    assert.equal(connected.length, 1);
    assert.ok(s.rec.animates(connected[0]), 'only the animation is connected');
    s.later(50);
    assert.equal(s.rec.named('set').length, sets, 'and nothing is set over it');
    // Where it ends, the style it rests at is set again.
    s.finish(s.started()[1]!);
    assert.deepEqual(s.set(), { opacity: 0.5 });
  });

  it('is kept as a view, for native to set values on', () => {
    const s = scene('fade');
    s.classesTo('fade gone');
    s.finish(s.started()[0]!);
    s.classesTo('half');
    assert.equal(s.props()['collapsable'], false);
  });

  it('lets go of the view once it is gone', () => {
    const s = scene('fade');
    s.classesTo('fade gone');
    s.finish(s.started()[0]!);
    s.classesTo('half');
    const tag = s.engine.tagOf(s.view);
    s.engine.removeChild(s.engine.root, s.view);
    s.engine.destroyNode(s.view);
    s.engine.commit();
    assert.deepEqual(s.rec.connected().get(tag), []);
  });
});

describe('a view no native animation has moved', () => {
  it('has its opacity and transform committed, and nothing set on native', () => {
    const s = scene('');
    s.classesTo('half');
    s.classesTo('turned');
    assert.equal(s.rec.named('toView').length, 0);
    assert.equal(s.props()['collapsable'] ?? undefined, undefined);
  });
});
