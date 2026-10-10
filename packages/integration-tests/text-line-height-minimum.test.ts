/**
 * Text is never laid out shorter than one of its lines. A browser's line box is as tall as its
 * `line-height` whatever holds it: in a row 32 points tall with 8 of padding above and below,
 * a 24 point line runs 4 points into each padding and is drawn whole. Yoga measures an item no
 * taller than the room inside its container, 16 points there, and the text view cuts its
 * letters off at that. So a paragraph with a line height in points has it as its least height.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const WINDOW = { width: 400, height: 800, colorScheme: 'light' } as const;

function scene(css: string, fontScale?: number) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css, 'app.css') as never,
    ...(fontScale === undefined ? {} : { conditions: { ...WINDOW, fontScale } }),
  });
  const say = (id: string, classes: string, words = 'Item 0'): EngineNode => {
    const text = engine.createElement('text');
    engine.setClasses(text, classes);
    engine.setProp(text, 'testID', id);
    engine.appendChild(text, engine.createText(words));
    engine.appendChild(engine.root, text);
    return text;
  };
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  /** The least height the paragraph called `id` is committed with. */
  const least = (id: string): unknown => {
    engine.commit();
    return (
      all(fabric.committed).find((each) => each.props['testID'] === id)!.props['minHeight'] ?? null
    );
  };
  return { engine, say, least };
}

describe('the least height of text', () => {
  it('is one line, where its line height is a length', () => {
    const s = scene(
      '.line { line-height: 24px } .rem { line-height: 1.5rem } .auto { min-height: auto; height: auto }',
    );
    s.say('line', 'line');
    s.say('rem', 'rem');
    s.say('auto', 'line auto');
    assert.equal(s.least('line'), 24);
    assert.equal(s.least('rem'), 24);
    // `auto` is what a browser starts both at, and is no height of its own.
    assert.equal(s.least('auto'), 24);
  });

  it('is left alone with no line height, a height of its own, or a least height of its own', () => {
    const s = scene(
      '.line { line-height: 24px } .short { height: 10px } .low { min-height: 4px } .tall { min-height: 40px }',
    );
    s.say('none', '');
    s.say('short', 'line short');
    s.say('low', 'line low');
    s.say('tall', 'line tall');
    assert.equal(s.least('none'), null);
    assert.equal(s.least('short'), null, 'a box given a height is that height');
    assert.equal(s.least('low'), 4);
    assert.equal(s.least('tall'), 40);
  });

  it('is its line and what is around it, where its size is its border box', () => {
    // A paragraph's own padding and border are inside the height Yoga gives it: with only the
    // line as its least, 8 points of padding above and below left the line 8 points to be in.
    const s = scene(
      '.pad { line-height: 24px; padding: 8px 4px; border-top-width: 1px } .content { box-sizing: content-box }',
    );
    s.say('pad', 'pad');
    s.say('content', 'pad content');
    assert.equal(s.least('pad'), 41);
    assert.equal(s.least('content'), 24);
  });

  it('is the tallest line of the text in it, a run with a line height of its own among them', () => {
    const s = scene(
      '.line { line-height: 24px } .big { line-height: 32px } .small { line-height: 12px }',
    );
    const text = s.say('text', 'line', 'A ');
    const run = (classes: string) => {
      const inner = s.engine.createElement('text');
      s.engine.setClasses(inner, classes);
      s.engine.appendChild(inner, s.engine.createText('run'));
      s.engine.appendChild(text, inner);
      return inner;
    };
    run('small');
    assert.equal(s.least('text'), 24);
    const big = run('big');
    assert.equal(s.least('text'), 32);
    s.engine.removeChild(text, big);
    assert.equal(s.least('text'), 24);
  });

  it('follows the line height changing, and going', () => {
    const s = scene('.line { line-height: 24px } .big { line-height: 32px }');
    const text = s.say('text', 'line');
    assert.equal(s.least('text'), 24);
    s.engine.setClasses(text, 'big');
    assert.equal(s.least('text'), 32);
    s.engine.setClasses(text, '');
    assert.equal(s.least('text'), null);
  });

  it('is a line as the system text size draws it, which scales the line and not the box', () => {
    // A line of 24 points is 19.2 tall at a text size of 0.8. Held to 24, it sits at the top
    // of its box, over what a row centres it beside.
    const s = scene('.line { line-height: 24px } .pad { padding: 4px 0 }', 0.8);
    s.say('small', 'line');
    s.say('padded', 'line pad');
    const fixed = s.say('fixed', 'line');
    s.engine.setProp(fixed, 'allowFontScaling', false);
    assert.equal(s.least('small'), 19.2);
    // What is around the line is points, whatever the text size.
    assert.equal(s.least('padded'), 27.2);
    // Text that does not scale is a line as written.
    assert.equal(s.least('fixed'), 24);
    // And follows the text size changing.
    s.engine.updateConditions({ ...WINDOW, fontScale: 1.5 });
    assert.equal(s.least('small'), 36);
    assert.equal(s.least('fixed'), 24);
  });

  it('scales each run by its own text size, where a run does not scale or stops at a size', () => {
    // At a text size of 2: a run that does not scale is its 32 points beside a 24 point line
    // drawn 48 tall, and one that stops at one and a half times is 48 itself.
    const s = scene('.line { line-height: 24px } .big { line-height: 32px }', 2);
    const run = (into: EngineNode, key: string, value: unknown) => {
      const inner = s.engine.createElement('text');
      s.engine.setClasses(inner, 'big');
      s.engine.setProp(inner, key, value);
      s.engine.appendChild(inner, s.engine.createText('run'));
      s.engine.appendChild(into, inner);
      return inner;
    };
    run(s.say('fixed', 'line', 'A '), 'allowFontScaling', false);
    assert.equal(s.least('fixed'), 48);
    run(s.say('capped', 'line', 'A '), 'maxFontSizeMultiplier', 1.5);
    assert.equal(s.least('capped'), 48);
    // And a run in a paragraph that does not scale does not either, with nothing of its own.
    const still = s.say('still', 'line', 'A ');
    s.engine.setProp(still, 'allowFontScaling', false);
    const inner = run(still, 'testID', 'inner');
    assert.equal(s.least('still'), 32);
    // Until it says it does.
    s.engine.setProp(inner, 'allowFontScaling', true);
    assert.equal(s.least('still'), 64);
  });
});
