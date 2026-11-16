/**
 * The device test host's recorder: what the app commits, on every surface a window renders on, and
 * whether a screen transition keeps the app busy.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeFabric, type FakeFabricNode } from '../test-utils.ts';
import { record } from './recorder.ts';
import { placeInlineSnapshots } from './snapshots.ts';

function commit(fabric: ReturnType<typeof record>['fabric'], rootTag: number, nodes: unknown[]) {
  const set = fabric.createChildSet(rootTag);
  for (const node of nodes) fabric.appendChildToSet(set, node as never);
  fabric.completeRoot(rootTag, set);
}

describe('the device recorder', () => {
  it("keeps each window's views, as each surface commits", () => {
    const recorder = record(createFakeFabric());
    const { fabric } = recorder;
    recorder.fabric.registerEventHandler!(() => {});
    const main = fabric.createNode(2, 'RCTView', 1, {}, {});
    const second = fabric.createNode(4, 'RCTView', 11, {}, {});
    commit(fabric, 1, [main]);
    commit(fabric, 11, [second]);
    assert.deepEqual(
      recorder.committed().map((node) => node.reactTag),
      [2, 4],
      'the main window is still there once the second commits',
    );
    assert.doesNotThrow(() => recorder.emit(2, 'topPress'));
    commit(fabric, 11, []);
    assert.deepEqual(
      recorder.committed().map((node) => node.reactTag),
      [2],
      'a window that commits nothing has nothing',
    );
  });

  it('counts a transition afresh once one that never ended has run out', () => {
    const fake = createFakeFabric();
    const recorder = record(fake);
    recorder.fabric.registerEventHandler!(() => {});
    const screen = recorder.fabric.createNode(2, 'RCTView', 1, {}, {}) as unknown as FakeFabricNode;
    const now = Date.now;
    let time = now();
    Date.now = () => time;
    try {
      fake.emit(screen, 'topWillAppear', {});
      time += 3001;
      assert.equal(recorder.busy(), false, 'a transition that never ended stops counting');
      fake.emit(screen, 'topWillAppear', {});
      assert.equal(recorder.busy(), true);
      fake.emit(screen, 'topAppear', {});
      time += 200;
      assert.equal(recorder.busy(), false, 'the new one ended: the app is idle');
    } finally {
      Date.now = now;
    }
  });
});

describe('inline snapshots on a device', () => {
  it('keeps where a snapshot is when Metro cannot place its frame', async () => {
    // Unplaced, a frame is still in the bundle: no source file to write the snapshot into.
    const snapshot = { file: '/app/src/a.device.ts', line: 3, column: 5 };
    await placeInlineSnapshots({ _inlineSnapshots: [snapshot] }, 'http://metro/a.device.bundle');
    assert.deepEqual(snapshot, { file: '/app/src/a.device.ts', line: 3, column: 5 });
  });
});
