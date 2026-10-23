/**
 * A node cloned for a change beneath it is handed its children in the one call. Fabric's tree is
 * persistent: a changed child makes each box above it a new node with a new list of children,
 * and a page's box holds hundreds. `appendChild` for each of them, on every commit, was a third
 * of the time a busy screen spent.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

it('clones a box with its children in one call, and none appended after', () => {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const page = engine.createElement('view');
  engine.appendChild(engine.root, page);
  const rows = [0, 1, 2, 3].map((at) => {
    const row = engine.createElement('view');
    engine.setProp(row, 'nativeID', `row${at}`);
    engine.appendChild(page, row);
    return row;
  });
  engine.commit();

  let appended = 0;
  const append = fabric.appendChild.bind(fabric);
  fabric.appendChild = (parent, child) => (appended++, append(parent, child));
  try {
    engine.setProp(rows[2]!, 'nativeID', 'changed');
    engine.commit();
    assert.equal(appended, 0, 'no child appended to a clone');
    const ids = fabric.committed[0]!.children.map((row) => row.props['nativeID']);
    assert.deepEqual(ids, ['row0', 'row1', 'changed', 'row3']);
    // And with props of its own as well as other children.
    engine.setProp(page, 'nativeID', 'page');
    engine.removeChild(page, rows[0]!);
    engine.commit();
    assert.equal(appended, 0);
    assert.equal(fabric.committed[0]!.props['nativeID'], 'page');
    assert.equal(fabric.committed[0]!.children.length, 3);
  } finally {
    fabric.appendChild = append;
  }
});
