/**
 * A row that aligns its items by their baselines, with a hidden box first in one of them. Yoga
 * takes an item's baseline from its first child that is not out of the flow, and a child with
 * `display: none` has no layout to take one from: the baseline is not a number, and neither is
 * the height of the row or the place of anything in it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { layOutTree } from './layout.ts';

const CSS =
  '.row { display: flex; flex-direction: row; align-items: baseline; width: 300px }' +
  ' .item { display: flex; flex-direction: column; min-height: 56px; width: 180px }' +
  ' .hidden { display: none } .shown { height: 20px }';

function scene(children: readonly string[]) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(CSS, 'app.css') as never });
  const add = (classes: string, parent: EngineNode) => {
    const node = engine.createElement('view');
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes);
    engine.appendChild(parent, node);
    return node;
  };
  const item = add('item', add('row', engine.root));
  const nodes = children.map((classes) => add(classes, item));
  const height = (id: string) => {
    engine.commit();
    const sizes = layOutTree(fabric.committed, { width: 400, height: 800 });
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of all) {
        const found = each.props['nativeID'] === id ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    return sizes.get(find(fabric.committed)!)!.height;
  };
  return { engine, nodes, height };
}

describe('a hidden box first in an item of a row aligned by baselines', () => {
  it('leaves the row as tall as the item', () => {
    const s = scene(['hidden']);
    assert.equal(s.height('row'), 56);
    assert.equal(s.height('item'), 56);
  });

  it('leaves the box after it to give the baseline', () => {
    const s = scene(['hidden', 'shown']);
    assert.equal(s.height('item'), 56);
    assert.equal(s.height('shown'), 20);
  });

  it('is in the flow again once it is shown', () => {
    const s = scene(['hidden shown']);
    assert.equal(s.height('item'), 56);
    s.engine.setClasses(s.nodes[0]!, 'shown');
    assert.equal(s.height('item'), 56);
    assert.equal(s.height('hidden shown'), 20);
    // In the flow it is what the item's height is made of: out of it, the item is its minimum.
    s.engine.setProp(s.nodes[0]!, 'style', { height: 80 });
    assert.equal(s.height('item'), 80);
  });

  it('is passed over where a style override is what hides it, or says where it is placed', () => {
    const s = scene(['shown', 'shown two']);
    s.engine.setProp(s.nodes[0]!, 'styleOverride', { display: 'none' });
    assert.equal(s.height('item'), 56);
    assert.equal(s.height('shown two'), 20);
    const hidden = scene(['hidden', 'shown']);
    hidden.engine.setProp(hidden.nodes[0]!, 'styleOverride', { position: 'relative' });
    assert.equal(hidden.height('item'), 56);
  });
});
