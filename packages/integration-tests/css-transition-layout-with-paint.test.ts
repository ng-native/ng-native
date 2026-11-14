/**
 * A box whose size and colour transition together. The engine lays a size out natively (one
 * commit to where it ends, with `configureNextLayoutAnimation`) and eases a colour from JavaScript,
 * a commit a frame that updates the same view. React Native's LayoutAnimationKeyFrameManager ends
 * a running layout animation at its last frame when a later commit updates the view it moves, so
 * the size jumped to where it ends on the first colour frame. The same C++ runs on every OS.
 *
 * In Chrome both ease over their own durations, so a box with a transition eased from JavaScript
 * eases its size from JavaScript too.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

function scene(css: string) {
  const fabric = createFakeFabric();
  const asked: unknown[] = [];
  Object.assign(fabric, {
    configureNextLayoutAnimation: (config: unknown) => void asked.push(config),
  });
  const clock = { now: 0 };
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css) as StyleSheet,
    now: () => clock.now,
  });
  const box: EngineNode = engine.createElement('view');
  engine.setClasses(box, 'c');
  engine.appendChild(engine.root, box);
  engine.commit();
  engine.advanceAnimations();
  const frame = (ms: number) => {
    clock.now += ms;
    engine.advanceAnimations();
    engine.commit();
  };
  const committed = () => fabric.committed[0]!.props;
  return { engine, box, asked, frame, committed };
}

it('eases the width from JavaScript when the same box eases its colour from JavaScript', () => {
  const { engine, box, asked, frame, committed } = scene(`
    .c { width: 10px; background-color: blue; transition: width 200ms linear, background-color 200ms linear }
    .c.on { width: 30px; background-color: red }
  `);
  engine.setClasses(box, 'c on');
  engine.commit();
  frame(100);
  assert.deepEqual(asked, [], 'no layout animation for a view committed every frame');
  assert.equal(Math.round(Number(committed()['width'])), 20);
  frame(100);
  assert.equal(Number(committed()['width']), 30);
});

it('takes a width native is laying out back to JavaScript as a colour starts easing', () => {
  const { engine, box, asked, frame, committed } = scene(`
    .c { width: 10px; background-color: blue; transition: width 200ms linear, background-color 200ms linear }
    .c.wide { width: 30px }
    .c.wide.red { background-color: red }
  `);
  engine.setClasses(box, 'c wide');
  engine.commit();
  assert.equal(asked.length, 1, 'the width alone is laid out natively');
  frame(50);
  engine.setClasses(box, 'c wide red');
  engine.commit();
  frame(50);
  assert.equal(Math.round(Number(committed()['width'])), 20, 'where its clock has got to');
  frame(100);
  assert.equal(Number(committed()['width']), 30);
});

it('still lays a width out natively on a box whose colour does not change', () => {
  const { engine, box, asked, committed } = scene(`
    .c { width: 10px; background-color: blue; transition: width 200ms linear, background-color 200ms linear }
    .c.on { width: 30px }
  `);
  engine.setClasses(box, 'c on');
  engine.commit();
  assert.equal(asked.length, 1);
  assert.equal(Number(committed()['width']), 30, 'committed where it ends, for native to move');
});
