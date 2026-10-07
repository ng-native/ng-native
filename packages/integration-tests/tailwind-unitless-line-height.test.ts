/**
 * A unitless `line-height` in an app's global stylesheet, which the Tailwind build flattens. CSS
 * reads the number as a multiple of the element's own font size, whichever rule that size comes
 * from. An icon font's class says `font-size: 24px; line-height: 1`, and a component that draws
 * the icon smaller says `font-size: 16px` in a rule of its own: the line is then 16 tall, not
 * the 24 the two declarations of the first rule come to, which sits the icon low in its box.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const { flattenTailwind } = require('@ng-native/tailwind/flatten.cjs');

/** A text element with `classes`, under the sheet the Tailwind build makes of `css`. */
function lineOf(css: string, classes: string): { fontSize: unknown; lineHeight: unknown } {
  const fabric = createFakeFabric();
  const sheet = compileCss(flattenTailwind(css), 'app.css');
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const text = engine.createElement('text');
  engine.setClasses(text, classes);
  engine.appendChild(text, engine.createText('a'));
  engine.appendChild(engine.root, text);
  engine.commit();
  const { fontSize, lineHeight } = fabric.committed[0]!.props;
  return { fontSize, lineHeight };
}

const ICONS = '.icons { font-size: 24px; line-height: 1 } .small { font-size: 16px }';

describe('a unitless line-height beside a font-size, through the Tailwind build', () => {
  it('is a multiple of the size another rule gives the element', () => {
    assert.deepEqual(lineOf(ICONS, 'icons small'), { fontSize: 16, lineHeight: 16 });
  });

  it('is a multiple of the size beside it where no other rule gives one', () => {
    assert.deepEqual(lineOf(ICONS, 'icons'), { fontSize: 24, lineHeight: 24 });
  });

  it('comes to the points Tailwind means by a text size and its leading', () => {
    const size = (rem: number, leading: number) =>
      lineOf(`.t { font-size: ${rem}rem; line-height: calc(${leading} / ${rem}) }`, 't');
    assert.deepEqual(size(1.125, 1.75), { fontSize: 18, lineHeight: 28 });
    assert.deepEqual(size(0.75, 1), { fontSize: 12, lineHeight: 16 });
    assert.deepEqual(size(0.875, 1.25), { fontSize: 14, lineHeight: 20 });
    assert.deepEqual(size(2.25, 2.5), { fontSize: 36, lineHeight: 40 });
    assert.deepEqual(size(2, 2.5), { fontSize: 32, lineHeight: 40 });
  });
});
