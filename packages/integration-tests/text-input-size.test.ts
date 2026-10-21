/**
 * A text input's `size`: how many characters wide it is where nothing else says, as an
 * `<input>` is twenty of its own font's in a browser, inside its padding and border. A native
 * field has no width of its own: in a row it is as wide as nothing.
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
  const width = () => {
    engine.commit();
    const wide = fabric.committed[0]!.props['width'];
    return typeof wide === 'number' ? Math.round(wide) : (wide ?? null);
  };
  return { engine, input, width };
}

const FONT = 'text-input { font-size: 16px }';

describe('size on a text input', () => {
  it('is that many characters of its font, with its padding and border', () => {
    // What Chrome makes of twenty: 175 points of a 16 point font.
    assert.equal(field(FONT, { size: 20 }).width(), 175);
    const padded = `${FONT} text-input { padding: 8px 12px; border-width: 1px }`;
    // As written in a template, the attribute is text.
    assert.equal(field(padded, { size: '20' }).width(), 201);
    // A content box's width is its characters alone: Yoga adds the padding and border itself.
    const content = `${padded} text-input { box-sizing: content-box }`;
    assert.equal(field(content, { size: 20 }).width(), 175);
    assert.equal(field('text-input { font-size: 32px }', { size: 10 }).width(), 175);
  });

  it('gives way to a width of its own, and is one where `auto` is written', () => {
    assert.equal(field(`${FONT} text-input { width: 80px }`, { size: 20 }).width(), 80);
    assert.equal(field(`${FONT} text-input { width: 50% }`, { size: 20 }).width(), '50%');
    assert.equal(field(`${FONT} text-input { width: auto }`, { size: 20 }).width(), 175);
  });

  it('is nothing with no size, and counts in a browser field’s font where none is written', () => {
    assert.equal(field(FONT, {}).width(), null);
    // 13.33 points, which a browser draws a field in: 146 of them for twenty characters.
    assert.equal(field('', { size: 20 }).width(), 146);
  });

  it('follows the size changing, and going', () => {
    const input = field(FONT, { size: 20 });
    assert.equal(input.width(), 175);
    input.engine.setProp(input.input, 'size', 10);
    assert.equal(input.width(), 87);
    input.engine.setProp(input.input, 'size', null);
    assert.equal(input.width(), null);
  });

  it('is not sent to the native field, which has no such prop', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(FONT, 'app.css') as never });
    const input = engine.createElement('text-input');
    engine.setProp(input, 'size', 20);
    engine.appendChild(engine.root, input);
    engine.commit();
    assert.equal('size' in fabric.committed[0]!.props, false);
    // Another view's `size` is its own: a spinner's, a native control's.
    const spinner = engine.createElement('view');
    engine.setProp(spinner, 'size', 'large');
    engine.appendChild(engine.root, spinner);
    engine.commit();
    assert.equal(fabric.committed[1]!.props['size'], 'large');
  });
});

describe('size on a multiline text input', () => {
  it('counts a wider character, as a browser does for the columns of a text area', () => {
    // Twenty columns of a 16 point font: 183 points in Chrome, where a field's twenty are 175.
    assert.equal(field(FONT, { size: 20, multiline: true }).width(), 183);
    const padded = `${FONT} text-input { padding: 8px 12px; border-width: 1px }`;
    assert.equal(field(padded, { size: 20, multiline: true }).width(), 209);
  });
});
