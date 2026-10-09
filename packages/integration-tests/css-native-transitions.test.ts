/**
 * CSS transitions played by native. A transition of opacity or a transform is two values and a
 * curve: it is laid out as interpolations and started on the native side, as a `@keyframes`
 * animation of the same properties is, so a press that fades or slides something costs the
 * JavaScript thread one commit to start and one to end, and none between. A property native
 * cannot move this way, a width, is eased from JavaScript, a commit a frame.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';
import { recorder } from './native-animated.ts';

type Config = Record<string, unknown> & { type: string };

function scene(css: string) {
  const rec = recorder();
  const fabric = createFakeFabric();
  let now = 0;
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css) as StyleSheet,
    nativeAnimated: rec.native,
    now: () => now,
  });
  const view = engine.createElement('view');
  engine.setClasses(view, 'a');
  engine.appendChild(engine.root, view);
  const events: string[] = [];
  for (const name of ['topTransitionstart', 'topTransitionend']) {
    engine.setEventListener(view, name, (event) =>
      events.push(`${name.slice(13)} ${(event as { propertyName: string }).propertyName}`),
    );
  }
  engine.commit();
  // Seen once, as a view on screen has been: what comes after is a change to it.
  engine.advanceAnimations();
  const started = () => rec.named('start').map(([, id]) => id as number);
  /** What native paints on the view where the value it animates is at `value`. */
  const at = (value: number): Record<string, number> => {
    const configs = new Map<unknown, Config>(
      rec.named('create').map(([, tag, config]) => [tag, config as Config]),
    );
    const out: Record<string, number> = {};
    const live = new Set<unknown>();
    for (const [name, props] of rec.calls) {
      if (name === 'toView') live.add(props);
      if (name === 'fromView') live.delete(props);
    }
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
    for (const propsTag of live) {
      const style = configs.get((configs.get(propsTag)!['props'] as { style: unknown }).style)!;
      for (const [key, tag] of Object.entries(style['style'] as Record<string, unknown>)) {
        const colour = configs.get(tag)!;
        if (colour.type === 'color') {
          for (const part of ['r', 'g', 'b', 'a'])
            out[`${key}.${part}`] = round(evaluate(colour[part]));
          continue;
        }
        if (key !== 'transform') {
          out[key] = round(evaluate(tag));
          continue;
        }
        const transforms = configs.get(tag)!['transforms'] as {
          property: string;
          nodeTag?: unknown;
          value?: number;
        }[];
        for (const entry of transforms) {
          out[entry.property] = round(entry.nodeTag ? evaluate(entry.nodeTag) : entry.value!);
        }
      }
    }
    return out;
  };
  const classes = (names: string) => {
    engine.setClasses(view, names);
    engine.commit();
  };
  const props = () => fabric.committed[0]!.props;
  const later = (ms: number) => {
    now += ms;
    const live = engine.advanceAnimations();
    engine.commit();
    return live;
  };
  return { engine, view, rec, events, started, at, classes, props, later, finish: rec.finish };
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

const FADE = '.a { opacity: 1; transition: opacity 200ms linear } .a.gone { opacity: 0 }';

describe('a transition of opacity or a transform', () => {
  it('is started on native, and leaves JavaScript nothing to do while it plays', () => {
    const s = scene(FADE);
    s.classes('a gone');
    assert.equal(s.started().length, 1);
    assert.equal(s.engine.animating, false);
    assert.deepEqual(s.at(0), { opacity: 1 });
    assert.deepEqual(s.at(0.5), { opacity: 0.5 });
    assert.deepEqual(s.at(1), { opacity: 0 });
    // The view is committed where it starts from, and native moves it from there.
    assert.equal(s.props()['opacity'], 1);
    assert.equal(s.props()['collapsable'], false);
    assert.deepEqual(s.events, ['start opacity']);
  });

  it('runs for a view that was told it has been seen, as one whose style was read back is', () => {
    // A library that makes an element, reads its style and then changes it means the change
    // to be a transition, and the read marks the element as no longer new.
    const s = scene(FADE);
    s.view.bornIn = undefined;
    s.classes('a gone');
    assert.equal(s.started().length, 1);
    assert.deepEqual(s.events, ['start opacity']);
  });

  it('ends a fade to nothing where the view still takes a touch, as it is committed', () => {
    // A see-through backdrop fades to no opacity and hears the press that closes its menu:
    // iOS passes over a view at none, so native stops where the view is committed.
    const s = scene(FADE);
    s.engine.setResponder(s.view, {});
    s.classes('a gone');
    assert.deepEqual(s.at(1), { opacity: 0.011 });
    s.finish(s.started()[0]!);
    assert.equal(s.props()['opacity'], 0.011);
    // One told to take no touch has none to miss.
    const untouched = scene(`${FADE} .a { pointer-events: none }`);
    untouched.engine.setResponder(untouched.view, {});
    untouched.classes('a gone');
    assert.deepEqual(untouched.at(1), { opacity: 0 });
  });

  it('takes a fade back from native where the view comes to take a touch part way', () => {
    // Native was given the fade to nothing before the view had a responder, and would end it
    // there: it is eased from JavaScript from where it has got to, and committed short of it.
    const s = scene(FADE);
    s.classes('a gone');
    s.later(50);
    s.engine.setResponder(s.view, {});
    s.engine.commit();
    assert.equal(s.rec.named('stop').length, 1);
    assert.equal(s.props()['opacity'], 0.75);
    s.later(200);
    assert.equal(s.props()['opacity'], 0.011);
  });

  it('is committed where it ends when native says it has, and says so itself', () => {
    const s = scene(FADE);
    s.classes('a gone');
    s.finish(s.started()[0]!);
    assert.equal(s.props()['opacity'], 0);
    assert.deepEqual(s.events, ['start opacity', 'end opacity']);
    assert.equal(s.rec.named('fromView').length, 1, 'and the view is let go');
    assert.equal(s.engine.animating, false);
  });

  it('eases by its curve, and moves a transform with it', () => {
    const s = scene(
      '.a { transform: translateX(0px) scale(1); opacity: 1; ' +
        'transition: transform 300ms ease-in, opacity 300ms ease-in } ' +
        '.a.gone { transform: translateX(40px) scale(2); opacity: 0 }',
    );
    s.classes('a gone');
    // One clock for the two: they start together, take as long and ease alike.
    assert.equal(s.started().length, 1);
    assert.equal(s.engine.animating, false);
    assert.deepEqual(s.at(0), { opacity: 1, translateX: 0, scaleX: 1, scaleY: 1 });
    assert.deepEqual(s.at(1), { opacity: 0, translateX: 40, scaleX: 2, scaleY: 2 });
    // ease-in is behind a straight line half way.
    assert.ok(s.at(0.5)['translateX']! < 20, `at ${s.at(0.5)['translateX']}`);
    assert.ok(s.at(0.5)['translateX']! > 5);
  });

  it('turns from where it has got to when it is sent another way before it ends', () => {
    const s = scene(FADE);
    s.classes('a gone');
    s.later(50);
    s.classes('a');
    // The first is stopped, and another started from a quarter of the way gone.
    assert.equal(s.rec.named('stop').length, 1);
    assert.equal(s.started().length, 2);
    assert.deepEqual(s.at(0), { opacity: 0.75 });
    assert.deepEqual(s.at(1), { opacity: 1 });
    assert.equal(s.props()['opacity'], 0.75);
    s.finish(s.started()[1]!);
    assert.equal(s.props()['opacity'], 1);
  });

  it('is eased from JavaScript where native cannot move the property: a width', () => {
    const s = scene('.a { width: 10px; transition: width 200ms linear } .a.gone { width: 30px }');
    s.classes('a gone');
    assert.equal(s.started().length, 0);
    assert.equal(s.engine.animating, true);
    s.later(100);
    assert.equal(s.props()['width'], 20);
  });

  it('is eased from JavaScript where it waits before it starts', () => {
    const s = scene(
      '.a { opacity: 1; transition: opacity 200ms linear 100ms } .a.gone { opacity: 0 }',
    );
    s.classes('a gone');
    assert.equal(s.started().length, 0);
    assert.equal(s.engine.animating, true);
  });

  it('is let go with the element, when that is taken away part way', () => {
    const s = scene(FADE);
    s.classes('a gone');
    s.engine.removeChild(s.engine.root, s.view);
    s.engine.commit();
    assert.equal(s.rec.named('stop').length, 1);
    assert.equal(s.rec.named('fromView').length, 1);
  });
});

describe('a transition native is playing, on an element merged again', () => {
  // Another prop of the element changes while native plays: the element is merged again, and
  // where the transition is going is what it was. Taken back to JavaScript for that, it stays
  // there, a commit a frame for the rest of it.
  it('is left to native where it is going to the value it has when nothing sets one', () => {
    const s = scene('.a { transition: opacity 200ms linear } .a.dim { opacity: 0.5 }');
    s.classes('a dim');
    s.finish(s.started()[0]!);
    s.classes('a');
    assert.equal(s.started().length, 2);
    s.engine.setProp(s.view, 'accessibilityLabel', 'beside');
    s.engine.commit();
    assert.equal(s.rec.named('stop').length, 0);
    assert.equal(s.engine.animating, false);
  });

  it('is left to native where it is going to a transform written the same again', () => {
    const s = scene(
      '.a { transform: scale(1); transition: transform 200ms linear } .a.on { transform: scale(2) }',
    );
    s.classes('a on');
    s.engine.setProp(s.view, 'accessibilityLabel', 'beside');
    s.engine.commit();
    assert.equal(s.rec.named('stop').length, 0);
    assert.equal(s.engine.animating, false);
  });
});

describe('a transition of a colour', () => {
  // What a press changes of a button, more often than anything: its background, for the time
  // the finger is down and again as it lifts.
  const TINT =
    '.a { background-color: rgb(200, 0, 0); transition: background-color 200ms linear } ' +
    '.a.on { background-color: rgba(0, 100, 50, 0.5) }';

  it('is played by native too, a channel at a time', () => {
    const s = scene(TINT);
    s.classes('a on');
    assert.equal(s.started().length, 1);
    assert.equal(s.engine.animating, false);
    assert.deepEqual(s.at(0), {
      'backgroundColor.r': 200,
      'backgroundColor.g': 0,
      'backgroundColor.b': 0,
      'backgroundColor.a': 1,
    });
    // Half way in premultiplied alpha, as a browser mixes two colours and as JavaScript does:
    // the more opaque of the two counts for more. A channel at a time it would be 100, 50, 25.
    const half = s.at(0.5);
    assert.ok(Math.abs(half['backgroundColor.r']! - 133) <= 1, `red ${half['backgroundColor.r']}`);
    assert.ok(Math.abs(half['backgroundColor.g']! - 33) <= 1, `green ${half['backgroundColor.g']}`);
    assert.ok(Math.abs(half['backgroundColor.b']! - 17) <= 1, `blue ${half['backgroundColor.b']}`);
    assert.equal(half['backgroundColor.a'], 0.75);
    s.finish(s.started()[0]!);
    assert.equal(s.props()['backgroundColor'], 'rgba(0, 100, 50, 0.5)');
    assert.deepEqual(s.events, ['start backgroundColor', 'end backgroundColor']);
  });

  it('shares a clock with an opacity that starts with it and eases alike', () => {
    const s = scene(
      '.a { opacity: 1; background-color: rgb(0, 0, 0); transition: all 200ms linear } ' +
        '.a.on { opacity: 0.5; background-color: rgb(10, 20, 30) }',
    );
    s.classes('a on');
    assert.equal(s.started().length, 1);
    assert.equal(s.at(1)['opacity'], 0.5);
    assert.equal(s.at(1)['backgroundColor.b'], 30);
  });
});
