/**
 * Cost and leak behaviour at size. `incremental-commit.test.ts` proves incremental commit is
 * *correct*; these prove it stays cheap as the tree grows, and that churn does not accumulate.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { mount, type MountResult } from '@ng-native/platform';
import type { EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ROWS = 1000;

interface Scale {
  setRows(rows: { id: number; label: string }[]): void;
}

const makeRows = (count: number, prefix = 'row') =>
  Array.from({ length: count }, (_, i) => ({ id: i, label: `${prefix} ${i}` }));

function walk(node: EngineNode): EngineNode[] {
  return [node, ...node.children.flatMap(walk)];
}

describe('engine at scale', () => {
  let Component: Type<unknown>;
  let fabric: FakeFabric;
  let app: MountResult;
  let instance: Scale;

  before(async () => {
    const mod = await compileFixture('fixtures/scale.ts');
    Component = mod['Scale'] as Type<unknown>;
  });

  beforeEach(async () => {
    fabric = createFakeFabric();
    app = mount(1, Component, fabric);
    instance = app.componentRef.instance as Scale;
    await settle();
  });

  it(`mounts ${ROWS} rows in one commit`, async () => {
    fabric.reset();
    const started = performance.now();
    instance.setRows(makeRows(ROWS));
    await settle();
    const elapsed = performance.now() - started;

    assert.equal(fabric.calls.completeRoot, 1, 'one commit for the whole list');
    // pressable + text + raw text per row.
    assert.equal(fabric.calls.createNode, ROWS * 3, 'each row created exactly once');
    console.log(`      ${ROWS} rows mounted in ${elapsed.toFixed(0)}ms`);
  });

  it('updates one row in a large list without touching the rest', async () => {
    instance.setRows(makeRows(ROWS));
    await settle();
    fabric.reset();

    const rows = makeRows(ROWS);
    rows[500] = { id: 500, label: 'edited' };
    const started = performance.now();
    instance.setRows(rows);
    await settle();
    const elapsed = performance.now() - started;

    assert.equal(fabric.calls.createNode, 0, 'nothing new is created');
    // The changed raw text, its <text>, its <pressable>, the list <view>, and the host.
    const clones =
      fabric.calls.cloneWithChildren +
      fabric.calls.cloneWithProps +
      fabric.calls.cloneWithChildrenAndProps;
    assert.ok(clones <= 8, `only the spine re-clones, got ${clones}`);
    console.log(`      1 of ${ROWS} rows updated with ${clones} clones in ${elapsed.toFixed(0)}ms`);
  });

  it('does not accumulate nodes or listeners across add/remove churn', async () => {
    /** Every listener the retained tree is holding, which is not the same as none. */
    const listeners = () =>
      walk(app.engine.root).reduce((total, node) => total + (node.listeners?.size ?? 0), 0);

    const baseline = walk(app.engine.root).length;
    /*
     * A count rather than an assertion that there are none, which is what this used to say.
     *
     * That held by accident: nothing in the starting tree happened to register a listener, so
     * "no accumulation" and "nothing at all" gave the same answer. They stopped agreeing the day
     * every pressable began listening for pointer enter and leave, and the test failed for a
     * change that leaked nothing. What it is actually about is the difference across the churn.
     */
    const baselineListeners = listeners();

    for (let cycle = 0; cycle < 5; cycle++) {
      instance.setRows(makeRows(200, `cycle ${cycle}`));
      await settle();
      instance.setRows([]);
      await settle();
    }

    assert.equal(
      walk(app.engine.root).length,
      baseline,
      'the retained tree returns to its starting size',
    );
    assert.equal(
      listeners(),
      baselineListeners,
      'and holds no more listeners than it started with',
    );
  });

  it('releases committed handles for removed subtrees', async () => {
    instance.setRows(makeRows(200));
    await settle();
    instance.setRows([]);
    await settle();

    const stillCommitted = walk(app.engine.root).filter((node) => node.committed !== null);
    const names = stillCommitted.map((node) => node.name).sort();
    // Only the surviving static subtree, and the root component's host above it, hold a Fabric
    // handle. The engine root is never committed itself: commit() walks its children straight
    // into the root child set.
    assert.deepEqual(names, ['#text', 'text', 'view', 'view', 'x-scale']);
  });
});
