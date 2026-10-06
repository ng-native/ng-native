/**
 * `@keyframes` animations played by native. One that moves only opacity and transforms is laid
 * out as interpolations and started on the native side, so nothing runs in JavaScript while it
 * plays: a spinner that turns for as long as its screen is open costs no frame of the JS thread.
 * Anything native cannot interpolate this way is played from JavaScript, a commit a frame.
 *
 * What native builds is checked by working the recorded graph out at a point of the animation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';
import { recorder } from './native-animated.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

type Config = Record<string, unknown> & { type: string };
/** What native is asked to run a value through. */
interface Started {
  type: string;
  iterations: number;
  toValue: number;
  frames: number[];
}

const FRAMES = `
  @keyframes spin { to { transform: rotate(360deg) } }
  @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes tint { from { background-color: red } to { background-color: blue } }
`;

function scene(
  rule: string,
  classes = 'a',
  frame?: { x: number; y: number; width: number; height: number },
) {
  const rec = recorder();
  const fabric = createFakeFabric();
  // Where the fake lays the view out, for what reads its size back.
  if (frame) fabric.frames.set('View', frame);
  let now = 0;
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(`${FRAMES} ${rule}`) as StyleSheet,
    nativeAnimated: rec.native,
    now: () => now,
  });
  const view = engine.createElement('view');
  engine.setClasses(view, classes);
  engine.appendChild(engine.root, view);
  const events: string[] = [];
  for (const name of ['topAnimationstart', 'topAnimationend', 'topAnimationcancel']) {
    engine.setEventListener(view, name, () => void events.push(name.slice(3).toLowerCase()));
  }
  engine.commit();
  const started = () =>
    rec.named('start').map(([, id, , config]) => ({ id: id as number, ...(config as Started) }));
  /** What native paints on the view when the value it animates is at `value`. */
  const at = (value: number) => {
    const configs = new Map<unknown, Config>(
      rec.named('create').map(([, tag, config]) => [tag, config as Config]),
    );
    const live = new Map<unknown, unknown>();
    for (const [name, props, viewTag] of rec.calls) {
      if (name === 'toView') live.set(viewTag, props);
      if (name === 'fromView' && live.get(viewTag) === props) live.delete(viewTag);
    }
    const propsTag = live.get(engine.tagOf(view));
    if (propsTag === undefined) return null;
    const evaluate = (tag: unknown): number => {
      const config = configs.get(tag)!;
      if (config.type === 'value') return value;
      const parent = rec.named('connect').find(([, , child]) => child === tag)![1];
      return interpolate(
        evaluate(parent),
        config['inputRange'] as number[],
        config['outputRange'] as number[],
      );
    };
    const style = configs.get((configs.get(propsTag)!['props'] as { style: unknown }).style)!;
    const out: Record<string, number> = {};
    for (const [key, tag] of Object.entries(style['style'] as Record<string, unknown>)) {
      if (key !== 'transform') {
        out[key] = round(evaluate(tag));
        continue;
      }
      const transforms = configs.get(tag)!['transforms'] as {
        property: string;
        nodeTag: unknown;
      }[];
      for (const entry of transforms) out[entry.property] = round(evaluate(entry.nodeTag));
    }
    return out;
  };
  const props = () => {
    engine.commit();
    return fabric.committed[0]!.props;
  };
  const later = (ms: number) => {
    now += ms;
    engine.advanceAnimations();
    engine.commit();
  };
  return { engine, view, rec, events, started, at, props, later, finish: rec.finish };
}

function interpolate(x: number, input: number[], output: number[]): number {
  if (x <= input[0]!) return output[0]!;
  if (x >= input.at(-1)!) return output.at(-1)!;
  let i = 0;
  while (x > input[i + 1]!) i++;
  const span = input[i + 1]! - input[i]!;
  return output[i]! + ((output[i + 1]! - output[i]!) * (x - input[i]!)) / (span || 1);
}
const round = (value: number) => Math.round(value * 1000) / 1000;

describe('a @keyframes animation of opacity and transforms', () => {
  it('is started on native, and leaves JavaScript nothing to do while it plays', () => {
    const s = scene('.a { animation: spin 1s linear infinite }');
    const [animation] = s.started();
    assert.equal(animation!.type, 'frames');
    assert.equal(animation!.iterations, -1);
    assert.equal(animation!.toValue, 1);
    // A second at sixty frames of it, from nothing to all of it.
    assert.equal(animation!.frames.length, 61);
    assert.equal(animation!.frames[0], 0);
    assert.equal(animation!.frames.at(-1), 1);
    assert.equal(s.engine.animating, false);
    assert.deepEqual(s.at(0.5), { rotate: round(Math.PI) });
    assert.deepEqual(s.events, ['animationstart']);
  });

  it('plays a transform that a frame adds a function to, from where the shorter list rests', () => {
    // A buffering bar's dots: `from` moves them back, and the end is the element's own transform,
    // a list one function shorter. CSS eases the missing function from where it is at rest.
    const marching =
      '@keyframes march { from { transform: rotate(180deg) translateX(-10px) } } ' +
      '.a { transform: rotate(180deg); animation: march 250ms linear infinite }';
    const s = scene(marching);
    assert.equal(s.started().length, 1);
    assert.equal(s.engine.animating, false);
    assert.deepEqual(s.at(0), { rotate: round(Math.PI), translateX: -10 });
    assert.deepEqual(s.at(0.5), { rotate: round(Math.PI), translateX: -5 });
    assert.deepEqual(s.at(1), { rotate: round(Math.PI), translateX: 0 });
    // And the other way: a frame with a function fewer than the one before it.
    const settling =
      '@keyframes settle { from { transform: translateX(8px) scale(2) } to { transform: translateX(0) } } ' +
      '.a { animation: settle 250ms linear infinite }';
    assert.deepEqual(scene(settling).at(0.5), { translateX: 4, scaleX: 1.5, scaleY: 1.5 });
  });

  it('plays from JavaScript a transform whose frames start with different functions', () => {
    const mixed =
      '@keyframes mixed { from { transform: rotate(90deg) } to { transform: translateX(8px) scale(2) } } ' +
      '.a { animation: mixed 250ms linear infinite }';
    const s = scene(mixed);
    assert.equal(s.started().length, 0);
    assert.equal(s.engine.animating, true);
  });

  it('plays a move by a share of the box, as the points it is once the box is laid out', () => {
    // A progress bar slides by `translateX(200%)` of its own width. Native interpolates points,
    // so the share is worked out from the size the view is laid out at, after its first commit.
    const sliding =
      '@keyframes slide { from { transform: translateX(0) } 50% { transform: translateX(50%) } ' +
      'to { transform: translateX(200%) translateY(-50%) } } .a { animation: slide 2s linear infinite }';
    const s = scene(sliding, 'a', { x: 0, y: 0, width: 300, height: 40 });
    assert.equal(s.started().length, 1);
    assert.equal(s.engine.animating, false, 'no frame of it is left to JavaScript');
    assert.deepEqual(s.at(0), { translateX: 0, translateY: 0 });
    assert.deepEqual(s.at(0.5), { translateX: 150, translateY: 0 });
    assert.deepEqual(s.at(1), { translateX: 600, translateY: -20 });
  });

  it('plays a move by a share from JavaScript for as long as the box has no size', () => {
    const s = scene(
      '@keyframes slide { to { transform: translateX(200%) } } .a { animation: slide 2s linear infinite }',
    );
    assert.equal(s.started().length, 0);
    assert.equal(s.engine.animating, true);
    s.later(1000);
    assert.deepEqual(s.props()['transform'], [{ translateX: '100%' }]);
  });

  it('plays an eased animation as the curve, sampled into what native interpolates between', () => {
    const s = scene('.a { animation: fade 1s ease-in infinite }');
    // Slow at first: well under halfway at the middle, and exact at the ends.
    assert.equal(s.at(0)!['opacity'], 0);
    assert.equal(s.at(1)!['opacity'], 1);
    assert.ok(s.at(0.5)!['opacity']! < 0.4);
  });

  it('plays there and back for alternate, as one animation of twice the length', () => {
    const s = scene('.a { animation: fade 1s linear infinite alternate }');
    const [animation] = s.started();
    assert.equal(animation!.toValue, 2);
    assert.equal(animation!.frames.length, 121);
    assert.equal(animation!.iterations, -1);
    assert.equal(s.at(0.5)!['opacity'], 0.5);
    assert.equal(s.at(1)!['opacity'], 1);
    assert.equal(s.at(1.75)!['opacity'], 0.25);
  });

  it('ends when native says so: its last frame held if it fills, and the view let go', () => {
    const s = scene('.a { animation: fade 400ms linear forwards }');
    assert.equal(s.props()['opacity'], 0);
    const [animation] = s.started();
    s.finish(animation!.id);
    assert.deepEqual(s.events, ['animationstart', 'animationend']);
    assert.equal(s.props()['opacity'], 1);
    assert.equal(s.at(0.5), null);
    assert.equal(s.engine.animating, false);
  });

  it('has native write its last frame as it ends, for a view that was not there while it played', () => {
    // A view is mounted when the task that made it is over. An animation as short as that task
    // is long is over on native before there is a view to move, and the view is then mounted at
    // the frame the animation started from, which nothing after would take it off.
    const s = scene('.a { animation: fade 120ms linear }');
    const [animation] = s.started();
    assert.deepEqual(s.rec.named('set'), []);
    s.finish(animation!.id);
    const names = s.rec.calls.map(([name]) => name);
    const set = s.rec.named('set');
    assert.equal(set.length, 1);
    assert.equal(set[0]![2], animation!.toValue, 'the end of what it was played to');
    assert.ok(names.lastIndexOf('set') < names.indexOf('fromView'), 'while the view is its own');
    assert.equal(s.at(0.5), null, 'and then let go');
  });

  it('ends at its resting style when it does not fill', () => {
    const s = scene('.a { opacity: 0.8; animation: fade 400ms linear }');
    s.finish(s.started()[0]!.id);
    assert.equal(s.props()['opacity'], 0.8);
    assert.equal(s.rec.named('stop').length, 0);
  });

  it('is stopped and let go when the animation is taken away', () => {
    const s = scene('.a { animation: spin 1s linear infinite }');
    s.engine.setClasses(s.view, '');
    s.engine.commit();
    assert.equal(s.rec.named('stop').length, 1);
    assert.equal(s.at(0.5), null);
    assert.deepEqual(s.events, ['animationstart', 'animationcancel']);
  });

  it('is stopped when its view leaves the tree', () => {
    const s = scene('.a { animation: spin 1s linear infinite }');
    s.engine.removeChild(s.engine.root, s.view);
    s.engine.commit();
    assert.equal(s.rec.named('stop').length, 1);
  });

  it('is handed back to JavaScript at the frame it has reached when it is paused', () => {
    const s = scene(
      '.a { animation: fade 1s linear infinite } .held { animation-play-state: paused }',
    );
    s.later(250);
    s.engine.setClasses(s.view, 'a held');
    assert.equal(s.props()['opacity'], 0.25);
    assert.equal(s.rec.named('stop').length, 1);
    assert.equal(s.at(0.5), null);
    // Running again, from where it stopped, a frame at a time.
    s.engine.setClasses(s.view, 'a');
    s.engine.commit();
    assert.equal(s.engine.animating, true);
    s.later(250);
    assert.equal(s.props()['opacity'], 0.5);
  });
});

describe('a @keyframes animation native cannot play', () => {
  it('is played from JavaScript when it moves anything but opacity and transforms', () => {
    const s = scene('.a { animation: tint 1s linear infinite }');
    assert.equal(s.started().length, 0);
    assert.equal(s.engine.animating, true);
  });

  it('is played from JavaScript when it waits before it starts, or starts paused', () => {
    assert.equal(scene('.a { animation: spin 1s linear 200ms infinite }').started().length, 0);
    const paused = scene('.a { animation: spin 1s linear infinite paused }');
    assert.equal(paused.started().length, 0);
  });

  it('is played from JavaScript with no native animation module', () => {
    const engine = new Engine(createFakeFabric(), 1, {
      globalStyles: compileCss(`${FRAMES} .a { animation: spin 1s linear infinite }`) as StyleSheet,
    });
    const view = engine.createElement('view');
    engine.setClasses(view, 'a');
    engine.appendChild(engine.root, view);
    engine.commit();
    assert.equal(engine.animating, true);
  });
});
