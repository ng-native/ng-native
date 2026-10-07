/**
 * CSS transitions played by native. A transition of opacity or a transform is two values and a
 * curve: it is laid out as interpolations and started on the native side, as a `@keyframes`
 * animation of the same properties is, so a press that fades or slides something costs the
 * JavaScript thread one commit to start and one to end, and none between. A property native
 * cannot move this way, a width, is eased from JavaScript, a commit a frame.
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
    const s = scene('.a { opacity: 1; transition: opacity 200ms linear 100ms } .a.gone { opacity: 0 }');
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
