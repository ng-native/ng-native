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

function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
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
    const s = scene('.line { line-height: 24px } .rem { line-height: 1.5rem }');
    s.say('line', 'line');
    s.say('rem', 'rem');
    assert.equal(s.least('line'), 24);
    assert.equal(s.least('rem'), 24);
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

  it('follows the line height changing, and going', () => {
    const s = scene('.line { line-height: 24px } .big { line-height: 32px }');
    const text = s.say('text', 'line');
    assert.equal(s.least('text'), 24);
    s.engine.setClasses(text, 'big');
    assert.equal(s.least('text'), 32);
    s.engine.setClasses(text, '');
    assert.equal(s.least('text'), null);
  });
});
