/**
 * A view's transform or opacity changed after a native animation has let it go. Once a graph of
 * React Native's animated module has set either on a view, no commit changes it again: iOS skips
 * both for good (`propKeysManagedByAnimated`), and Android puts the graph's last value back over
 * each commit (`overrideBySynchronousMountPropsAtMountingAndroid`). A later change is set on
 * native, through a graph that plays nothing, as well as committed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, registerPlatformComponents, type StyleSheet } from '@ng-native/fabric';
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
  .shown { opacity: 1 }
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

  it('has the style it rests at set on native, where that is the frame it started at', () => {
    // The resting opacity is the first frame, which the view was committed with as it played.
    const s = scene('shown leaves');
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

  it('has a later flat matrix set on native as numbers: a move, a turn, a skew and a scale', () => {
    // Set whole, a matrix is a list in a list, which native's transform node cannot take: the
    // view would stay where the transition left it.
    const s = scene('slide');
    s.classesTo('slide moved');
    s.finish(s.started()[0]!);
    s.engine.setProp(s.view, 'style', { transform: 'matrix(1, 0, 0, 1, 150, 0)' });
    s.classesTo('');
    assert.deepEqual(s.set(), {
      transform: [
        { translateX: 150 },
        { translateY: 0 },
        { rotate: 0 },
        { skewX: 0 },
        { scaleX: 1 },
        { scaleY: 1 },
      ],
    });
    // And numbers again after it.
    s.engine.setProp(s.view, 'style', { transform: 'translateX(60px)' });
    s.engine.commit();
    assert.deepEqual(s.set(), { transform: [{ translateX: 60 }] });
  });

  it('has a flat matrix bound part way through a transition native plays set on native', () => {
    const s = scene('slide');
    s.classesTo('slide moved');
    s.later(100);
    s.engine.setProp(s.view, 'style', { transform: 'matrix(1, 0, 0, 1, 150, 0)' });
    s.classesTo('');
    for (let frame = 0; frame < 4; frame++) s.later(50);
    assert.deepEqual((s.set()['transform'] as Record<string, number>[])[0], { translateX: 150 });
  });

  it('turns, skews, scales and flips the view as the matrix does', () => {
    for (const [a, b, c, d, e, f] of [
      [0.5, 0.866, -1.2, 0.9, 10, 20],
      [-1, 0, 0, 1, 0, 0],
      [0, 2, -3, 0, 4, 5],
    ] as const) {
      const s = scene('slide');
      s.classesTo('slide moved');
      s.finish(s.started()[0]!);
      s.engine.setProp(s.view, 'style', {
        transform: 'matrix(' + [a, b, c, d, e, f].join(', ') + ')',
      });
      s.classesTo('');
      const entries = s.set()['transform'] as Record<string, number>[];
      const part = (key: string) => entries.find((entry) => key in entry)![key]!;
      const [turn, skew] = [part('rotate'), Math.tan(part('skewX'))];
      const [sx, sy] = [part('scaleX'), part('scaleY')];
      // rotate(turn) skewX(skew) scale(sx, sy), as CSS composes them.
      const drawn = [
        Math.cos(turn) * sx,
        Math.sin(turn) * sx,
        (Math.cos(turn) * skew - Math.sin(turn)) * sy,
        (Math.sin(turn) * skew + Math.cos(turn)) * sy,
        part('translateX'),
        part('translateY'),
      ];
      drawn.forEach((value, index) =>
        assert.ok(Math.abs(value - [a, b, c, d, e, f][index]!) < 1e-9),
      );
    }
  });

  it('leaves a matrix in depth committed alone, as native cannot be set to it', () => {
    const s = scene('slide');
    s.classesTo('slide moved');
    s.finish(s.started()[0]!);
    const sets = s.rec.named('set').length;
    s.engine.setProp(s.view, 'style', {
      transform: 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -0.002, 150, 0, 0, 1)',
    });
    s.classesTo('');
    assert.equal(s.rec.named('set').length, sets);
    assert.deepEqual(s.props()['transform'], [
      { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -0.002, 150, 0, 0, 1] },
    ]);
  });

  it('leaves a sheared matrix committed alone on Android, which draws no skew', () => {
    // React Native on Android breaks a transform into what an Android view has, and a view has
    // no skew: a matrix with one is left committed, as before, where a flat one is still set.
    registerPlatformComponents('android');
    try {
      const sheared = scene('slide');
      sheared.classesTo('slide moved');
      sheared.finish(sheared.started()[0]!);
      const sets = sheared.rec.named('set').length;
      sheared.engine.setProp(sheared.view, 'style', { transform: 'matrix(1, 0, 0.5, 1, 150, 0)' });
      sheared.classesTo('');
      assert.equal(sheared.rec.named('set').length, sets, 'nothing set on native');
      const flat = scene('slide');
      flat.classesTo('slide moved');
      flat.finish(flat.started()[0]!);
      flat.engine.setProp(flat.view, 'style', { transform: 'matrix(1, 0, 0, 1, 150, 0)' });
      flat.classesTo('');
      assert.equal((flat.set()['transform'] as unknown[])[0] !== undefined, true);
    } finally {
      registerPlatformComponents('ios');
    }
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

describe('a view a native animation has moved, held unseen for a frame', () => {
  // `hold` keeps what a library inserts and then measures unseen until it is styled: its
  // opacity, committed as nothing, has to reach native where a graph has set the view's.
  it('is set unseen on native, and back at its own opacity once let go', () => {
    const s = scene('leaves');
    s.finish(s.started()[0]!);
    assert.deepEqual(s.set(), { opacity: 1 });
    s.engine.hold(s.view, true);
    s.engine.commit();
    assert.equal(s.props()['opacity'], 0);
    assert.deepEqual(s.set(), { opacity: 0 }, 'unseen on native too');
    s.engine.hold(s.view, false);
    s.engine.commit();
    assert.deepEqual(s.set(), { opacity: 1 });
  });

  it('starts on native once let go, a fade it is inserted with, which a graph would show', () => {
    // A graph that plays the opacity sets it over what is committed: started under the hold, a
    // fade out would be drawn at its first frame, whole, through the frame it is held unseen. A
    // browser starts it as it first paints the element, which is once the hold is over.
    const rec = recorder();
    const fabric = createFakeFabric();
    let now = 0;
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(CSS) as StyleSheet,
      nativeAnimated: rec.native,
      now: () => now,
    });
    const view = engine.createElement('view');
    engine.setClasses(view, 'leaves');
    engine.hold(view, true);
    engine.appendChild(engine.root, view);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['opacity'], 0);
    assert.equal(rec.named('start').length, 0, 'nothing native plays over the hold');
    now = 16;
    engine.advanceAnimations();
    engine.setProp(view, 'style', { width: 10 });
    engine.commit();
    assert.equal(rec.named('start').length, 0, 'nor once it is styled again, still held');
    engine.hold(view, false);
    engine.commit();
    assert.equal(rec.named('start').length, 1, 'played on native from here');
    assert.equal(fabric.committed[0]!.props['opacity'], 1, 'from its first frame');
  });

  it('starts its clock once let go, played from JavaScript as well', () => {
    const rec = recorder();
    const fabric = createFakeFabric();
    let now = 0;
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(
        `${CSS} @keyframes tint { to { background-color: blue } } .tints { animation: tint 200ms linear }`,
      ) as StyleSheet,
      nativeAnimated: rec.native,
      now: () => now,
    });
    const view = engine.createElement('view');
    engine.setClasses(view, 'tints');
    engine.hold(view, true);
    engine.appendChild(engine.root, view);
    engine.commit();
    now = 100;
    engine.hold(view, false);
    engine.commit();
    now = 250;
    engine.advanceAnimations();
    engine.commit();
    assert.equal(engine.animating, true, '150ms into its 200, not past its end');
  });

  it('starts paused once let go where it was paused while held', () => {
    const rec = recorder();
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(`${CSS} .paused { animation-play-state: paused }`) as StyleSheet,
      nativeAnimated: rec.native,
      now: () => 0,
    });
    const view = engine.createElement('view');
    engine.setClasses(view, 'leaves');
    engine.hold(view, true);
    engine.appendChild(engine.root, view);
    engine.commit();
    engine.setClasses(view, 'leaves paused');
    engine.hold(view, false);
    engine.commit();
    assert.equal(rec.named('start').length, 0, 'not played while paused');
    assert.equal(engine.animating, false);
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
