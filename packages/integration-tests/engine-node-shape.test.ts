/**
 * An engine node keeps the fields it was made with. A field written to a node made without it
 * gives the node another shape, and the engine and Angular read every node at sites that are then
 * slower for nodes of each shape. So what a commit writes to the nodes of a plain app, one that
 * sets inline styles, commits, restyles and removes, is a field every node is made with.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

describe('the fields of an engine node', () => {
  it('stay the ones it was made with through commits, a restyle and its removal', () => {
    const engine = new Engine(createFakeFabric(), 1, {});
    const fields = Object.keys(engine.createElement('view'));
    const list = engine.createElement('view');
    const row = engine.createElement('view');
    const label = engine.createElement('text');
    const words = engine.createText('row 1');
    engine.appendChild(label, words);
    engine.appendChild(row, label);
    engine.appendChild(list, row);
    engine.appendChild(engine.root, list);
    engine.setProp(row, 'style', { padding: 4, color: 'red' });
    engine.commit();
    engine.setProp(row, 'style', { padding: 6 });
    engine.commit();
    engine.removeChild(list, row);
    engine.commit();
    for (const node of [row, label, words]) engine.destroyNode(node);
    for (const node of [list, row, label, words]) assert.deepEqual(Object.keys(node), fields);
  });
});
