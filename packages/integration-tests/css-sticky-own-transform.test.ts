/**
 * A `position: sticky` box with a transform of its own. A browser draws both: the box is moved
 * by where it sticks, and its own transform is applied after that, whether it is still or in
 * transition. Native moves the box by the scroll with a graph that sets its transform, so that
 * graph has the box's own transform after the move, and a transition of the transform that
 * native plays is eased in that graph too, where the scroll still moves it.
 */
import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import type { FakeFabricNode } from '@ng-native/testing';
import { createLaidOutFabric } from './laid-out-fabric.ts';
import { recorder } from './native-animated.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

type Spec = [name: string, ...children: Spec[]];

// The box starts 50 down its section, which ends at 300: it moves from 50 to 270 of the scroll.
const PAGE =
  '.scroll { height: 200px } .section { height: 300px } .lead { height: 50px } ' +
  '.head { position: sticky; top: 0; height: 30px } ' +
  '.over { transform: translateX(10px) } .further { transform: translateX(25px) } ' +
  '.slides { transform: translateX(0px); transition: transform 200ms linear } ' +
  '.slides.moved { transform: translateX(40px) } ' +
  '.waits { transform: translateX(0px); transition: transform 200ms linear 100ms } ' +
  '.waits.moved { transform: translateX(40px) } ' +
  '.plain { position: relative } .loose { top: auto }';

const SPEC: Spec = ['page', ['scroll', ['section', ['lead'], ['box']]], ['scroll two']];

function scene(t: TestContext, classes: string, native = true) {
  // The shift a scroll writes on the box is written once the scroll pauses, on a timer.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rec = recorder();
  const fabric = createLaidOutFabric();
  let now = 0;
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(PAGE, 'app.css') as never,
    nativeAnimated: native ? rec.native : null,
    now: () => now,
  });
  const nodes = new Map<string, EngineNode>();
  const build = ([name, ...children]: Spec, parent: EngineNode): void => {
    const node = engine.createElement(name.startsWith('scroll') ? 'scroll-view' : 'view');
    engine.setClasses(node, name === 'box' ? `head ${classes}` : name);
    engine.setProp(node, 'nativeID', name);
    engine.appendChild(parent, node);
    nodes.set(name, node);
    for (const child of children) build(child, node);
  };
  build(SPEC, engine.root);
  engine.commit();
  // Seen once, as a view on screen has been: what comes after is a change to it.
  engine.advanceAnimations();
  engine.commit();
  const committed = (name: string): FakeFabricNode => {
    const find = (all: FakeFabricNode[]): FakeFabricNode | undefined =>
      all
        .flatMap((node) => (node.props['nativeID'] === name ? [node] : [find(node.children)]))
        .find(Boolean);
    return find(fabric.committed)!;
  };
  const box = nodes.get('box')!;
  return {
    engine,
    rec,
    nodes,
    committed,
    classes: (names: string) => {
      engine.setClasses(box, `head ${names}`);
      engine.commit();
    },
    /** The scroll view reports an offset, and the box's shift is written once it pauses. */
    scroll: (y: number, within = 'scroll') => {
      fabric.emit(committed(within), 'topScroll', { contentOffset: { x: 0, y } });
      t.mock.timers.tick(64);
      engine.commit();
    },
    later: (ms: number) => {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    },
    /** What native draws on the box with the scroll view at `scroll`. */
    drawn: (scroll: number, clock = 0) =>
      rec.drawn(committed('box').reactTag, { scroll, clock })['transform'],
    /** What the box is committed with. */
    transform: () => committed('box').props['transform'],
  };
}

const started = (s: ReturnType<typeof scene>) => s.rec.named('start').map(([, id]) => id as number);

describe('a sticky box with a transform of its own, moved by native', () => {
  it('is drawn moved by the scroll and by its own transform', (t) => {
    const s = scene(t, 'over');
    assert.deepEqual(s.drawn(0), [{ translateY: 0 }, { translateX: 10 }]);
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }, { translateX: 10 }]);
    assert.deepEqual(s.drawn(400), [{ translateY: 220 }, { translateX: 10 }]);
  });

  it('is drawn with its own transform as that changes, and without it once it goes', (t) => {
    const s = scene(t, 'over');
    s.classes('further');
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }, { translateX: 25 }]);
    s.classes('');
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }]);
    s.classes('over');
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }, { translateX: 10 }]);
  });

  it('eases its own transform on native, still moved by the scroll as it does', (t) => {
    const s = scene(t, 'slides');
    s.classes('slides moved');
    assert.equal(started(s).length, 1);
    assert.equal(s.engine.animating, false);
    assert.deepEqual(s.drawn(0, 0.5), [{ translateY: 0 }, { translateX: 20 }]);
    // A scroll part way: the box moves with it, and goes on easing.
    assert.deepEqual(s.drawn(120, 0.5), [{ translateY: 70 }, { translateX: 20 }]);
    assert.deepEqual(s.drawn(120, 1), [{ translateY: 70 }, { translateX: 40 }]);
  });

  it('starts easing from where it sticks, and goes where the scroll goes from there', (t) => {
    const s = scene(t, 'slides');
    s.scroll(120);
    assert.deepEqual(s.transform(), [{ translateY: 70 }, { translateX: 0 }]);
    s.classes('slides moved');
    assert.equal(started(s).length, 1);
    assert.deepEqual(s.drawn(120, 0), [{ translateY: 70 }, { translateX: 0 }]);
    assert.deepEqual(s.drawn(0, 0.5), [{ translateY: 0 }, { translateX: 20 }]);
  });

  it('keeps its own transform where the transition ends, still moved by the scroll', (t) => {
    const s = scene(t, 'slides');
    s.classes('slides moved');
    s.rec.finish(started(s)[0]!);
    assert.deepEqual(s.transform(), [{ translateX: 40 }]);
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }, { translateX: 40 }]);
    // The transition's nodes fed the drive's transform: each is let go of before either goes.
    const index = (...call: unknown[]) =>
      s.rec.calls.findIndex((each) => call.every((part, i) => each[i] === part));
    const eased = s.rec
      .named('connect')
      .filter(([, from]) => s.rec.named('start').some(([, , value]) => value === from))
      .map(([, , interpolation]) => interpolation);
    assert.equal(eased.length, 1);
    const fed = s.rec.named('connect').filter(([, from]) => from === eased[0]);
    assert.equal(fed.length, 1);
    const [, , transform] = fed[0]!;
    assert.ok(index('disconnect', eased[0], transform) !== -1);
    assert.ok(index('disconnect', eased[0], transform) < index('drop', transform));
    assert.ok(index('disconnect', eased[0], transform) < index('drop', eased[0]));
    // Eased back, and the transform taken away once that has ended.
    s.classes('slides');
    s.rec.finish(started(s)[1]!);
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }, { translateX: 0 }]);
    s.classes('');
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }]);
  });

  it('goes on easing from JavaScript where the transition is taken back part way', (t) => {
    const s = scene(t, 'slides');
    s.classes('slides moved');
    s.later(100);
    // Sent another way with no transition: what native played goes, and the box is at the end.
    s.classes('further');
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }, { translateX: 25 }]);
  });

  it('is drawn with its own transform as JavaScript eases it, moved by the scroll', (t) => {
    // One that waits is eased from JavaScript: each frame of it is committed.
    const s = scene(t, 'waits');
    s.classes('waits moved');
    assert.equal(started(s).length, 0);
    s.later(200);
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }, { translateX: 20 }]);
    s.later(200);
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }, { translateX: 40 }]);
  });

  it('is drawn with its own transform alone once it stops being sticky', (t) => {
    const s = scene(t, 'over');
    s.classes('over plain');
    assert.deepEqual(s.drawn(120), [{ translateX: 10 }]);
  });

  it('is drawn with its own transform alone once its inset goes, scrolled or not', (t) => {
    const s = scene(t, 'over');
    s.scroll(120);
    s.classes('over loose');
    assert.deepEqual(s.drawn(120), [{ translateX: 10 }]);
  });

  it('is drawn where it is laid out once it stops sticking, where it has no transform', (t) => {
    const s = scene(t, '');
    s.scroll(120);
    s.classes('loose');
    assert.deepEqual(s.drawn(120), []);
  });

  it('goes on easing its own transform from JavaScript where it stops being sticky part way', (t) => {
    const s = scene(t, 'slides');
    s.classes('slides moved');
    s.later(50);
    s.classes('slides moved plain');
    s.later(50);
    assert.deepEqual(s.drawn(120), [{ translateX: 20 }]);
  });

  it('keeps its own transform when it is moved into another scroll view', (t) => {
    const s = scene(t, 'over');
    const section = s.nodes.get('section')!;
    s.engine.removeChild(s.nodes.get('scroll')!, section);
    s.engine.appendChild(s.nodes.get('scroll two')!, section);
    s.engine.commit();
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }, { translateX: 10 }]);
  });

  it('goes on easing when it is moved into another scroll view part way', (t) => {
    const s = scene(t, 'slides');
    s.classes('slides moved');
    const section = s.nodes.get('section')!;
    s.engine.removeChild(s.nodes.get('scroll')!, section);
    s.engine.appendChild(s.nodes.get('scroll two')!, section);
    s.engine.commit();
    s.later(100);
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }, { translateX: 20 }]);
    s.later(100);
    assert.deepEqual(s.drawn(120), [{ translateY: 70 }, { translateX: 40 }]);
  });
});

describe('a sticky box with a transform of its own, moved from JavaScript', () => {
  it('is committed moved by the scroll and by its own transform as that eases', (t) => {
    const s = scene(t, 'slides', false);
    s.classes('slides moved');
    s.later(100);
    s.scroll(120);
    assert.deepEqual(s.transform(), [{ translateY: 70 }, { translateX: 20 }]);
    s.later(100);
    assert.deepEqual(s.transform(), [{ translateY: 70 }, { translateX: 40 }]);
    s.scroll(0);
    assert.deepEqual(s.transform(), [{ translateX: 40 }]);
  });
});
