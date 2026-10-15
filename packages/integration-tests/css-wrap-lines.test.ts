/**
 * The lines of a wrapping flex container, where it says nothing of `align-content`. CSS starts
 * them at `normal`, which in a flex container is `stretch`: each line is as tall (or, in a
 * column, as wide) as its share of the container. Yoga starts them at `flex-start`, as tall as
 * what is in them, so an item that stretches across its line comes out with no size at all.
 * Sizes are Chrome's.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { layOutTree } from './layout.ts';

/** A container `box` holding one item `item`, both styled by `css`, laid out. */
function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const box = engine.createElement('view');
  const item = engine.createElement('view');
  engine.setClasses(box, 'box');
  engine.setClasses(item, 'item');
  engine.appendChild(engine.root, box);
  engine.appendChild(box, item);
  /** The item's width and height, as Yoga lays out what was committed. */
  const size = () => {
    engine.commit();
    const sizes = layOutTree(fabric.committed, { width: 400, height: 800 });
    const committed = fabric.committed[0]!.children[0] as FakeFabricNode;
    const { width, height } = sizes.get(committed)!;
    return [width, height];
  };
  return { engine, box, size };
}

describe('the lines of a wrapping flex container', () => {
  it('stretch across a column that wraps, so an item is as wide as the container', () => {
    const { size } = scene('.box { width: 300px; height: 100px; flex-wrap: wrap }');
    assert.deepEqual(size(), [300, 0]);
  });

  it('stretch down a row that wraps, so an item is as tall as the container', () => {
    const { size } = scene(
      '.box { flex-direction: row; width: 300px; height: 100px; flex-wrap: wrap } .item { width: 50px }',
    );
    assert.deepEqual(size(), [50, 100]);
  });

  it('stretch for wrap-reverse as well', () => {
    const { size } = scene('.box { width: 300px; height: 100px; flex-wrap: wrap-reverse }');
    assert.deepEqual(size(), [300, 0]);
  });

  it('stretch where a bound style sets align-content to null, which says nothing of it', () => {
    const { engine, box, size } = scene('.box { width: 300px; height: 100px; flex-wrap: wrap }');
    engine.setProp(box, 'style', { alignContent: null });
    assert.deepEqual(size(), [300, 0]);
    assert.equal(box.committed?.props['alignContent'], 'stretch');
  });

  it('start where the container says they start', () => {
    const { size } = scene(
      '.box { width: 300px; height: 100px; flex-wrap: wrap; align-content: flex-start }',
    );
    assert.deepEqual(size(), [0, 0]);
  });

  it('are left alone by a container that does not wrap, or stops wrapping', () => {
    const { engine, box, size } = scene(
      '.box { width: 300px; height: 100px } .wraps { flex-wrap: wrap }',
    );
    assert.deepEqual(size(), [300, 0]);
    engine.setClasses(box, 'box wraps');
    assert.deepEqual(size(), [300, 0]);
    assert.equal(box.committed?.props['alignContent'], 'stretch');
    engine.setClasses(box, 'box');
    assert.deepEqual(size(), [300, 0]);
    assert.equal(box.committed?.props['alignContent'] ?? undefined, undefined);
  });
});
