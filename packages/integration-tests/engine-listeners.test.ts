/**
 * What a node keeps of its listeners once they are taken off. A node can outlive its listeners:
 * `destroyNode` leaves them for projected content Angular puts back, so each goes through the
 * teardown `setEventListener` returns, and that teardown leaves nothing behind it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

function mounted() {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const node = engine.createElement('view');
  engine.appendChild(engine.root, node);
  engine.commit();
  return { engine, node };
}

describe('taking a listener off a node', () => {
  it('drops the type with its last listener, and the map with its last type', () => {
    const { engine, node } = mounted();
    const offPress = engine.setEventListener(node, 'topTouchEnd', () => {});
    const offOther = engine.setEventListener(node, 'topTouchEnd', () => {});
    const offLayout = engine.setEventListener(node, 'topLayout', () => {});

    offPress();
    assert.deepEqual([...node.listeners!.keys()], ['topTouchEnd', 'topLayout']);
    offOther();
    assert.deepEqual([...node.listeners!.keys()], ['topLayout'], 'no empty set for the type');
    offLayout();
    assert.equal(node.listeners, null, 'no empty map on the node');
  });

  it('leaves nothing over many listens and teardowns, as a list that mounts and unmounts does', () => {
    const { engine, node } = mounted();
    for (let i = 0; i < 100; i++) engine.setEventListener(node, `topEvent${i}`, () => {})();
    assert.equal(node.listeners, null);
  });

  it('leaves a later listener of the type alone when an old teardown runs again', () => {
    const { engine, node } = mounted();
    const offFirst = engine.setEventListener(node, 'topTouchEnd', () => {});
    offFirst();
    const log: string[] = [];
    engine.setEventListener(node, 'topTouchEnd', () => log.push('second'));

    offFirst();
    engine.dispatchEvent(node, 'topTouchEnd', {});
    assert.deepEqual(log, ['second']);
  });

  it('leaves the same function listening again alone when its old teardown runs again', () => {
    const { engine, node } = mounted();
    const log: string[] = [];
    const heard = () => log.push('heard');
    const offFirst = engine.setEventListener(node, 'topTouchEnd', heard);
    offFirst();
    engine.setEventListener(node, 'topTouchEnd', heard);

    offFirst();
    engine.dispatchEvent(node, 'topTouchEnd', {});
    assert.deepEqual(log, ['heard']);
  });
});
