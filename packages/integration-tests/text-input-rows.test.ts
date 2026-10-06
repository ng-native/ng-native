/**
 * A multiline text input's `rows`: how many lines tall it is where nothing else says, as a
 * `<textarea rows="3">` is three lines of its line height in a browser. A native field is as
 * tall as its text, which with none typed is one line.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

function field(css: string, props: Record<string, unknown>) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const input = engine.createElement('text-input');
  for (const [key, value] of Object.entries(props)) engine.setProp(input, key, value);
  engine.appendChild(engine.root, input);
  const height = () => {
    engine.commit();
    return fabric.committed[0]!.props['height'] ?? null;
  };
  return { engine, input, height };
}

const LINES = 'text-input { line-height: 20px }';

describe('rows on a multiline text input', () => {
  it('is that many lines of its line height, with its padding and border', () => {
    assert.equal(field(LINES, { multiline: true, rows: 3 }).height(), 60);
    const padded = `${LINES} text-input { padding: 4px 0; border-width: 1px }`;
    // As written in a template, the attribute is text.
    assert.equal(field(padded, { multiline: true, rows: '3' }).height(), 70);
    // A content box's height is its lines alone: Yoga adds the padding and border itself.
    const content = `${padded} text-input { box-sizing: content-box }`;
    assert.equal(field(content, { multiline: true, rows: 3 }).height(), 60);
  });

  it('gives way to a height of its own, and is no height where `auto` is written', () => {
    const fixed = field(`${LINES} text-input { height: 44px }`, { multiline: true, rows: 3 });
    assert.equal(fixed.height(), 44);
    const auto = field(`${LINES} text-input { height: auto }`, { multiline: true, rows: 3 });
    assert.equal(auto.height(), 60);
  });

  it('is nothing on a field of one line, or with no line height to count in', () => {
    assert.equal(field(LINES, { rows: 3 }).height(), null);
    assert.equal(field('', { multiline: true, rows: 3 }).height(), null);
  });

  it('follows the rows changing, and going', () => {
    const area = field(LINES, { multiline: true, rows: 2 });
    assert.equal(area.height(), 40);
    area.engine.setProp(area.input, 'rows', 4);
    assert.equal(area.height(), 80);
    area.engine.setProp(area.input, 'rows', null);
    assert.equal(area.height(), null);
  });
});
