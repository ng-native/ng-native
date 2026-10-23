/**
 * Paint sent to native without a commit. A view whose transform, opacity or background is changed
 * again and again, a progress bar stepped every 50ms, is moved by React Native's animated nodes,
 * as `Animated` with the native driver moves one: each change is a value set on native, with no
 * commit, no layout and no clone of the path from the root. The first change is committed as any
 * other; the second soon after is the one that hands the view over.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { compileCss } from '@ng-native/testing';
import { createLaidOutFabric } from './laid-out-fabric.ts';
import { recorder } from './native-animated.ts';

function scene(css: string, native = true) {
  const rec = recorder();
  const fabric = createLaidOutFabric();
  let now = 0;
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css) as StyleSheet,
    nativeAnimated: native ? rec.native : null,
    now: () => now,
  });
  const view = engine.createElement('view');
  engine.setClasses(view, 'bar');
  engine.setProp(view, 'nativeID', 'bar');
  engine.appendChild(engine.root, view);
  engine.commit();
  engine.advanceAnimations();
  const commits = () => fabric.calls.completeRoot;
  const style = (value: Record<string, unknown>) => {
    engine.setProp(view, 'style', value);
    engine.commit();
  };
  /** Step `ms` on, and change the style, as a timer that ticks would. */
  const tick = (ms: number, value: Record<string, unknown>) => {
    now += ms;
    engine.advanceAnimations();
    style(value);
  };
  /** What native paints on the view, each value node at its last value. */
  const painted = () => {
    assert.ok((rec.connected().get(engine.tagOf(view)) ?? []).length <= 1, 'one graph at a time');
    return rec.painted(engine.tagOf(view));
  };
  const classes = (names: string) => {
    engine.setClasses(view, names);
    engine.commit();
  };
  /** Native reaching the end of the last animation it was started on. */
  const finishLast = () => rec.finish(rec.named('start').at(-1)![1] as number);
  const later = (ms: number) => {
    now += ms;
    engine.advanceAnimations();
  };
  return { engine, view, rec, fabric, commits, style, tick, painted, classes, finishLast, later };
}

const BAR = '.bar { width: 200px; height: 10px; background-color: red }';
const move = (x: number) => ({ transform: [{ translateX: x }] });

describe('a transform changed again and again', () => {
  it('is sent to native from the second change, with no commit', () => {
    const s = scene(BAR);
    const before = s.commits();
    s.tick(50, move(10));
    s.tick(50, move(20));
    // The change that hands the view over is committed, keeping a view for native to move.
    assert.equal(s.commits(), before + 2);
    assert.equal(s.fabric.committed[0]!.props['collapsable'], false);
    s.tick(50, move(30));
    s.tick(50, move(40));
    s.tick(50, move(50));
    assert.equal(s.commits(), before + 2);
    assert.deepEqual(s.painted(), { transform: [{ translateX: 50 }] });
  });

  it('commits a change made once, as before', () => {
    const s = scene(BAR);
    const before = s.commits();
    s.tick(50, move(10));
    s.tick(5000, move(20));
    assert.equal(s.commits(), before + 2);
    assert.equal(s.rec.named('toView').length, 0);
    assert.deepEqual(s.fabric.committed[0]!.props['transform'], [{ translateX: 20 }]);
  });

  it('is committed every time where there is no native animated module', () => {
    const s = scene(BAR, false);
    const before = s.commits();
    for (let x = 10; x <= 50; x += 10) s.tick(50, move(x));
    assert.equal(s.commits(), before + 5);
    assert.deepEqual(s.fabric.committed[0]!.props['transform'], [{ translateX: 50 }]);
  });

  it('is committed at its current value with the next change of anything else', () => {
    const s = scene(BAR);
    for (let x = 10; x <= 50; x += 10) s.tick(50, move(x));
    assert.deepEqual(s.fabric.committed[0]!.props['transform'], [{ translateX: 20 }]);
    s.tick(50, { ...move(60), height: 20 });
    const props = s.fabric.committed[0]!.props;
    assert.deepEqual(props['transform'], [{ translateX: 60 }]);
    assert.equal(props['height'], 20);
    // And set on native too, which owns the view's transform from here.
    assert.deepEqual(s.painted(), { transform: [{ translateX: 60 }] });
  });

  it('is committed where it is before the view is measured', () => {
    const s = scene(BAR);
    for (let x = 10; x <= 50; x += 10) s.tick(50, move(x));
    const before = s.commits();
    s.engine.measure(s.view, () => undefined);
    assert.equal(s.commits(), before + 1);
    assert.deepEqual(s.fabric.committed[0]!.props['transform'], [{ translateX: 50 }]);
  });

  it('sends a move by a share of the box as the points it is of the box', () => {
    const s = scene(BAR);
    for (let x = 10; x <= 50; x += 10) s.tick(50, { transform: `translateX(-${100 - x}%)` });
    assert.deepEqual(s.painted(), { transform: [{ translateX: -100 }] });
  });

  it('builds the graph again for a transform of another shape', () => {
    const s = scene(BAR);
    for (let x = 10; x <= 30; x += 10) s.tick(50, move(x));
    s.tick(50, { transform: [{ translateX: 40 }, { scale: 2 }] });
    assert.deepEqual(s.painted(), { transform: [{ translateX: 40 }, { scale: 2 }] });
    s.tick(50, { transform: [{ translateX: 45 }, { scale: 3 }] });
    assert.deepEqual(s.painted(), { transform: [{ translateX: 45 }, { scale: 3 }] });
  });

  it('lets native go when the view leaves the tree', () => {
    const s = scene(BAR);
    for (let x = 10; x <= 50; x += 10) s.tick(50, move(x));
    s.engine.removeChild(s.engine.root, s.view);
    s.engine.commit();
    assert.deepEqual(s.painted(), {});
  });
});

describe('an opacity or background changed again and again', () => {
  it('sends each to native', () => {
    const s = scene(BAR);
    const before = s.commits();
    s.tick(50, { opacity: 0.1, backgroundColor: 'rgb(0, 0, 10)' });
    s.tick(50, { opacity: 0.2, backgroundColor: 'rgb(0, 0, 20)' });
    s.tick(50, { opacity: 0.3, backgroundColor: 'rgb(0, 0, 30)' });
    assert.equal(s.commits(), before + 2);
    assert.deepEqual(s.painted(), { opacity: 0.3, backgroundColor: [0, 0, 30, 1] });
  });
});

describe('a transform with a transition, aimed somewhere else again and again', () => {
  const EASED = `${BAR} .bar { transition: transform 150ms linear }`;

  it('eases the value native already has, with no commit', () => {
    const s = scene(EASED);
    for (let x = 10; x <= 30; x += 10) s.tick(50, move(x));
    const before = s.commits();
    s.tick(50, move(40));
    s.tick(50, move(50));
    assert.equal(s.commits(), before);
    const starts = s.rec.named('start');
    const last = starts.at(-1)!;
    assert.equal((last[3] as { toValue: number }).toValue, 50);
    // The one before was stopped, rather than left to fight it for the same value.
    assert.ok(s.rec.named('stop').some(([, id]) => id === starts.at(-2)![1]));
  });
});

describe('a view sent to native that then stops changing', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  it('is committed where it is once it has been left alone', () => {
    const s = scene(BAR);
    for (let x = 10; x <= 50; x += 10) s.tick(50, move(x));
    const before = s.commits();
    mock.timers.tick(1000);
    assert.equal(s.commits(), before + 1);
    assert.deepEqual(s.fabric.committed[0]!.props['transform'], [{ translateX: 50 }]);
  });
});

describe('a view whose transform or opacity a native animation has set', () => {
  // React Native lets no commit change either again once a graph has set it: iOS skips them
  // (`propKeysManagedByAnimated`) and Android puts the graph's last value back over them.
  const CSS =
    `${BAR} .eased { transition: transform 150ms linear, opacity 150ms linear } ` +
    '@keyframes nudge { to { transform: translateX(80px) } } ' +
    '.nudged { animation: nudge 300ms linear }';

  it('has a change made after a transition ended set on native too', () => {
    const s = scene(CSS);
    s.classes('bar eased');
    s.later(50);
    s.style(move(100));
    s.finishLast();
    s.later(2000);
    s.classes('bar');
    s.later(2000);
    const before = s.commits();
    s.style(move(200));
    assert.deepEqual(s.painted(), { transform: [{ translateX: 200 }] });
    // And committed, as a change on its own always is.
    assert.equal(s.commits(), before + 1);
    assert.deepEqual(s.fabric.committed[0]!.props['transform'], [{ translateX: 200 }]);
  });

  it('has an opacity changed after a fade ended set on native too', () => {
    const s = scene(CSS);
    s.classes('bar eased');
    s.later(50);
    s.style({ opacity: 0.2 });
    s.finishLast();
    s.later(2000);
    s.classes('bar');
    s.later(2000);
    s.style({ opacity: 1 });
    assert.deepEqual(s.painted(), { opacity: 1 });
  });

  it('is set on native at its resting style where an animation that does not fill ends', () => {
    const s = scene(CSS);
    s.classes('bar nudged');
    s.finishLast();
    assert.deepEqual(s.painted(), { transform: [] });
    s.later(2000);
    s.style(move(180));
    assert.deepEqual(s.painted(), { transform: [{ translateX: 180 }] });
  });

  it('is left to a transition native plays on the view while it plays', () => {
    const s = scene(CSS);
    s.classes('bar eased');
    s.later(50);
    s.style(move(100));
    s.finishLast();
    s.later(2000);
    const starts = s.rec.named('start').length;
    s.style(move(200));
    assert.equal(s.rec.named('start').length, starts + 1, 'a second transition on native');
    // Nothing set over the transform it moves: it would be at its end before it started.
    assert.deepEqual(s.rec.painted(s.engine.tagOf(s.view)), {});
  });

  it('is committed alone once the view is made again, which no graph has set', () => {
    const s = scene(CSS);
    s.classes('bar eased');
    s.later(50);
    s.style(move(100));
    s.finishLast();
    s.engine.removeChild(s.engine.root, s.view);
    s.engine.commit();
    s.classes('bar');
    s.engine.appendChild(s.engine.root, s.view);
    s.engine.commit();
    s.later(2000);
    s.style(move(200));
    assert.deepEqual(s.painted(), {});
    assert.deepEqual(s.fabric.committed[0]!.props['transform'], [{ translateX: 200 }]);
  });
});

describe('a value the transform node cannot take, on a view native paints', () => {
  // Android puts the last transform set on native back over each commit that carries one, and
  // copies back only the numbers and strings of each entry: a matrix, a list, comes back as `{}`,
  // which draws the view where it was never moved (overrideBySynchronousMountPropsAtMountingAndroid).
  it('is set on native as numbers: a flat matrix, as a move, a turn, a skew and a scale', () => {
    const s = scene(BAR);
    for (let x = 10; x <= 50; x += 10) s.tick(50, move(x));
    s.tick(50, { transform: 'matrix(1, 0, 0, 1, 150, 0)' });
    assert.deepEqual(s.painted(), {
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
    s.tick(50, move(60));
    assert.deepEqual(s.painted(), { transform: [{ translateX: 60 }] });
  });

  it('turns, skews, scales and flips as the matrix does', () => {
    for (const [a, b, c, d, e, f] of [
      [0.5, 0.866, -1.2, 0.9, 10, 20],
      [-1, 0, 0, 1, 0, 0],
      [0, 2, -3, 0, 4, 5],
    ]) {
      const s = scene(BAR);
      for (let x = 10; x <= 50; x += 10) s.tick(50, move(x));
      s.tick(50, { transform: `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})` });
      const entries = s.painted()['transform'] as Record<string, number>[];
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
      drawn.forEach((value, at) => assert.ok(Math.abs(value - [a, b, c, d, e, f][at]!) < 1e-9));
    }
  });

  it('is set on native whole: a matrix in three dimensions', () => {
    const s = scene(BAR);
    for (let x = 10; x <= 50; x += 10) s.tick(50, move(x));
    const deep = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -0.002, 150, 0, 0, 1];
    s.tick(50, { transform: [{ matrix: deep }] });
    assert.deepEqual(s.painted(), { transform: [{ matrix: deep }] });
  });

  it('commits a colour it cannot parse, and goes on painting the rest', () => {
    const s = scene(BAR);
    for (let at = 1; at <= 3; at++) {
      s.tick(50, { opacity: at / 10, backgroundColor: `rgb(0, 0, ${at})` });
    }
    const platform = { semantic: ['systemBlue'] };
    s.tick(50, { opacity: 0.4, backgroundColor: platform });
    assert.deepEqual(s.painted(), { opacity: 0.4 });
    assert.ok(s.fabric.committed[0]!.props['backgroundColor'] !== undefined);
  });
});

describe('a move by a share of the box, on a view native paints', () => {
  it('is set again in points of the box it has after a commit resizes it', () => {
    const s = scene(BAR);
    for (let x = 10; x <= 50; x += 10) s.tick(50, { transform: `translateX(-${x}%)` });
    assert.deepEqual(s.painted(), { transform: [{ translateX: -100 }] });
    s.tick(50, { transform: 'translateX(-50%)', width: 100 });
    assert.deepEqual(s.painted(), { transform: [{ translateX: -50 }] });
  });
});

describe('what reads where a view is drawn, while native paints one ahead of the shadow tree', () => {
  it('has every view native paints committed before a view inside one is measured', () => {
    const s = scene(BAR);
    const inner = s.engine.createElement('view');
    s.engine.appendChild(s.view, inner);
    s.engine.commit();
    for (let x = 10; x <= 50; x += 10) s.tick(50, move(x));
    const before = s.commits();
    s.engine.measure(inner, () => undefined);
    assert.equal(s.commits(), before + 1);
    assert.deepEqual(s.fabric.committed[0]!.props['transform'], [{ translateX: 50 }]);
  });
});

describe('a painted view whose transitions change shape, take presses, or follow a setter', () => {
  const BOTH = `${BAR} .bar { transition: transform 150ms linear, opacity 150ms linear }`;

  it('hands a transform it eases back to JavaScript before an opacity joins the graph', () => {
    const s = scene(BOTH);
    for (let x = 10; x <= 40; x += 10) s.tick(50, move(x));
    s.tick(10, { ...move(40), opacity: 0.5 });
    // Built again for the opacity, the graph would have dropped the transform's ease and left
    // it marked as native's, never to end, and drawn at its target at once.
    const eased = s.view.transitions?.get('transform');
    assert.ok(eased && !eased.done, 'the transform is still on its way');
    assert.notEqual(
      eased.native?.keys.includes('transform') && !eased.native.keys.includes('opacity'),
      true,
    );
    s.later(300);
    assert.equal(s.engine.animating, false, 'and ends');
  });

  it('eases an opacity it paints on a view that takes presses to no lower than takes a touch', () => {
    // A backdrop that fades out: eased to nothing, iOS would let presses through it.
    const s = scene(`${BAR} .bar { transition: opacity 150ms linear }`);
    s.engine.setResponder(s.view, {});
    for (const opacity of [0.5, 0.4, 0.3, 0]) s.tick(50, { opacity });
    const to = (s.rec.named('start').at(-1)![3] as { toValue: number }).toValue;
    assert.ok(to >= 0.011, `eased to ${to}`);
  });

  it("lets go of the setter's graph on the view when it paints it", () => {
    const s = scene(`${BAR} .bar.fade { transition: opacity 150ms linear }`);
    s.classes('bar fade');
    s.style({ opacity: 0.5 });
    s.finishLast();
    s.classes('bar');
    // Each change from here: the first is the setter's, and the painter's from the run on.
    for (const opacity of [0.4, 0.3, 0.2, 0.1]) s.tick(50, { opacity });
    assert.ok((s.rec.connected().get(s.engine.tagOf(s.view)) ?? []).length <= 1, 'one graph');
  });
});

describe('a painted view a native graph once owned an opacity on', () => {
  it('paints a one-off opacity change, which a commit would no longer show', () => {
    const s = scene(`${BAR} .bar.fade { transition: opacity 150ms linear }`);
    s.classes('bar fade');
    s.style({ opacity: 0.5 });
    s.finishLast();
    s.classes('bar');
    // A run of transform changes hands the view to the painter, with only its transform.
    for (let x = 10; x <= 40; x += 10) s.tick(50, { ...move(x), opacity: 0.5 });
    // Changed once, long after the fade: no run of its own.
    s.tick(1500, { ...move(40), opacity: 0.8 });
    assert.equal(s.painted()['opacity'], 0.8);
  });
});

describe('a painted view given its first transform with a transition', () => {
  it('eases it from where no transform leaves it, rather than jumping there', () => {
    const s = scene(`${BAR} .bar { transition: transform 150ms linear }`);
    // A run of opacity changes hands the view to the painter, with no transform yet.
    for (const opacity of [0.9, 0.8, 0.7, 0.6]) s.tick(50, { opacity });
    s.tick(50, { opacity: 0.6, ...move(100) });
    const start = s.rec.named('start').at(-1);
    assert.ok(start, 'an ease is started');
    assert.equal((start[3] as { toValue: number }).toValue, 100);
    // From where no transform leaves the view: the value node starts at nothing.
    const node = start[2];
    const created = s.rec.named('create').find(([, tag]) => tag === node)!;
    assert.equal((created[2] as { value: number }).value, 0);
  });
});

describe('a painted view a native @keyframes animation starts on', () => {
  it('lets the painter go first, taking back what it was easing, so one graph moves the view', () => {
    const css =
      `${BAR} .bar { transition: transform 150ms linear }` +
      ' @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }' +
      ' .bar.spin { animation: spin 1s linear infinite }';
    const s = scene(css);
    for (let x = 10; x <= 40; x += 10) s.tick(50, move(x));
    s.tick(10, move(80));
    s.classes('bar spin');
    const graphs = s.rec.connected().get(s.engine.tagOf(s.view)) ?? [];
    assert.equal(graphs.length, 1, 'one graph on the view');
    assert.equal(s.view.transitions?.get('transform')?.native, undefined, 'none left native');
  });
});
