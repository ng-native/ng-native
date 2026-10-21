/**
 * The lines of a wrapping flex container, where it says nothing of `align-content`. CSS starts
 * them at `normal`, which in a flex container is `stretch`: each line is as tall (or, in a
 * column, as wide) as its share of the container. Yoga starts them at `flex-start`, as tall as
 * what is in them, so an item that stretches across its line comes out with no size at all.
 * Numbers are Chrome's.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

/** A container `box` holding one item `item`, both styled by `css`, laid out. */
function scene(css: string) {
  const fabric = createLaidOutFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const box = engine.createElement('view');
  const item = engine.createElement('view');
  for (const [node, name] of [
    [box, 'box'],
    [item, 'item'],
  ] as const) {
    engine.setClasses(node, name);
    engine.setProp(node, 'nativeID', name);
  }
  engine.appendChild(engine.root, box);
  engine.appendChild(box, item);
  const rect = (name: string) => {
    engine.commit();
    const { left, top, width, height } = fabric.box(name);
    return [left, top, width, height];
  };
  return { engine, box, rect };
}

describe('the lines of a wrapping flex container', () => {
  it('stretch across a column that wraps, so an item is as wide as the container', () => {
    const { rect } = scene('.box { width: 300px; height: 100px; flex-wrap: wrap }');
    assert.deepEqual(rect('item'), [0, 0, 300, 0]);
  });

  it('stretch down a row that wraps, so an item is as tall as the container', () => {
    const { rect } = scene(
      '.box { flex-direction: row; width: 300px; height: 100px; flex-wrap: wrap } .item { width: 50px }',
    );
    assert.deepEqual(rect('item'), [0, 0, 50, 100]);
  });

  it('stretch for wrap-reverse as well', () => {
    const { rect } = scene('.box { width: 300px; height: 100px; flex-wrap: wrap-reverse }');
    assert.deepEqual(rect('item'), [0, 0, 300, 0]);
  });

  it('stretch where a bound style sets align-content to null, which says nothing of it', () => {
    const { engine, box, rect } = scene('.box { width: 300px; height: 100px; flex-wrap: wrap }');
    engine.setProp(box, 'style', { alignContent: null });
    assert.deepEqual(rect('item'), [0, 0, 300, 0]);
    assert.equal(box.committed?.props['alignContent'], 'stretch');
  });

  it('start where the container says they start', () => {
    const { rect } = scene(
      '.box { width: 300px; height: 100px; flex-wrap: wrap; align-content: flex-start }',
    );
    assert.deepEqual(rect('item'), [0, 0, 0, 0]);
  });

  it('are left alone by a container that does not wrap, or stops wrapping', () => {
    const { engine, box, rect } = scene(
      '.box { width: 300px; height: 100px } .wraps { flex-wrap: wrap }',
    );
    assert.deepEqual(rect('item'), [0, 0, 300, 0]);
    engine.setClasses(box, 'box wraps');
    assert.deepEqual(rect('item'), [0, 0, 300, 0]);
    assert.equal(box.committed?.props['alignContent'], 'stretch');
    engine.setClasses(box, 'box');
    assert.deepEqual(rect('item'), [0, 0, 300, 0]);
    assert.equal(box.committed?.props['alignContent'] ?? undefined, undefined);
  });
});
