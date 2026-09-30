/**
 * A node taken out of the tree and put back under the same parent.
 *
 * Fabric drops an unmounted view's event target and never makes a new one
 * (`EventEmitter::setEnabled`), so a view committed again after a commit it was left out of takes
 * no touch. The fake models that. A node out of the tree when a commit runs is created afresh when
 * it comes back; one moved within a single pass never left, and keeps its views.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

function setUp() {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const parent = engine.createElement('view');
  engine.setProp(parent, 'nativeID', 'parent');
  const child = engine.createElement('view');
  engine.setProp(child, 'nativeID', 'child');
  const grandchild = engine.createElement('view');
  engine.setProp(grandchild, 'nativeID', 'grandchild');
  engine.appendChild(child, grandchild);
  engine.appendChild(parent, child);
  engine.appendChild(engine.root, parent);
  const touches: EngineNode[] = [];
  for (const node of [child, grandchild]) {
    engine.setResponder(node, {
      onStartShouldSetResponder: () => (touches.push(node), true),
    });
  }
  engine.commit();

  const find = (id: string): FakeFabricNode | undefined => {
    const walk = (nodes: FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const n of nodes) {
        if (n.props['nativeID'] === id) return n;
        const hit = walk(n.children);
        if (hit) return hit;
      }
      return undefined;
    };
    return walk(fabric.committed);
  };
  const touch = (id: string): number => {
    touches.length = 0;
    const target = find(id)!;
    fabric.emit(target, 'topTouchStart', { touches: [{}], changedTouches: [{}] });
    fabric.emit(target, 'topTouchEnd', { touches: [], changedTouches: [{}] });
    return touches.length;
  };
  return { fabric, engine, parent, child, grandchild, find, touch };
}

describe('a node removed and put back under the same parent', () => {
  it('takes touches after a commit it was left out of', () => {
    const { engine, parent, child, find, touch } = setUp();
    assert.equal(touch('grandchild'), 1);

    engine.removeChild(parent, child);
    engine.commit();
    assert.equal(find('child'), undefined);

    engine.appendChild(parent, child);
    engine.commit();
    assert.equal(touch('child'), 1, 'the node itself');
    assert.equal(touch('grandchild'), 1, 'and what is under it');
  });

  it('keeps its views when it is moved within one pass', () => {
    const { engine, fabric, parent, child, find, touch } = setUp();
    const before = find('child')!.reactTag;
    fabric.reset();
    engine.removeChild(parent, child);
    engine.appendChild(parent, child);
    engine.commit();
    assert.equal(find('child')!.reactTag, before);
    assert.equal(fabric.calls.createNode, 0);
    assert.equal(touch('child'), 1);
  });
});
