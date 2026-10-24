/**
 * The laid-out fake Fabric itself, where it stands in for what a device does beyond laying out:
 * moving what a scroll view holds as it is told to scroll.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';
import { layOutFabric } from './laid-out-fabric.ts';

function scene(scrolls: boolean) {
  const fabric = layOutFabric(createFakeFabric(), { scrolls });
  const engine = new Engine(fabric, 1, {});
  const scroller = engine.createElement('scroll-view');
  engine.setProp(scroller, 'style', { height: 100 });
  const inside = engine.createElement('view');
  engine.setProp(inside, 'style', { height: 500 });
  engine.setProp(inside, 'nativeID', 'inside');
  engine.appendChild(scroller, inside);
  engine.appendChild(engine.root, scroller);
  engine.commit();
  return { fabric, engine, scroller };
}

describe('the laid-out fake Fabric', () => {
  it('moves what a scroll view holds by as far as it is told to scroll', () => {
    const { fabric, engine, scroller } = scene(true);
    assert.equal(fabric.box('inside').top, 0);
    engine.dispatchCommand(scroller, 'scrollTo', [5, 40, false]);
    assert.deepEqual([fabric.box('inside').left, fabric.box('inside').top], [-5, -40]);
    engine.dispatchCommand(scroller, 'scrollTo', [0, 0, false]);
    assert.equal(fabric.box('inside').top, 0, 'and back');
  });

  it('leaves it where it is laid out where it was not asked to', () => {
    const { fabric, engine, scroller } = scene(false);
    engine.dispatchCommand(scroller, 'scrollTo', [0, 40, false]);
    assert.equal(fabric.box('inside').top, 0);
  });
});
