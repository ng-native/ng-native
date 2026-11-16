/**
 * `Engine.watchProp`: hearing a prop change on a node, as the directive that follows an app's own
 * `nativeID` does.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

function scene() {
  const engine = new Engine(createFakeFabric(), 1, {
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });
  const node = engine.createElement('view');
  engine.appendChild(engine.root, node);
  return { engine, node };
}

describe('a prop watched on a node', () => {
  it('keeps a later watcher when an earlier one is stopped twice', () => {
    const { engine, node } = scene();
    const heard: unknown[] = [];
    const stopFirst = engine.watchProp(node, 'nativeID', () => {});
    stopFirst();
    const stopSecond = engine.watchProp(node, 'nativeID', (value) => heard.push(value));
    try {
      stopFirst();
      engine.setProp(node, 'nativeID', 'row');
      assert.deepEqual(heard, ['row']);
    } finally {
      stopSecond();
    }
  });
});
