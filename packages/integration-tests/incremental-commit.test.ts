/**
 * Incremental commit. A full rebuild per tick mints fresh shadow nodes for untouched
 * subtrees, which drops scroll offset, text cursor and keyboard focus. These tests exist to
 * prove that does not happen.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { mount, type MountResult } from '@ng-native/platform';
import { createFakeFabric, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

interface List {
  setItems(items: { id: number; label: string }[]): void;
  setStyle(style: Record<string, unknown>): void;
}

function byTag(nodes: FakeFabricNode[], tag: string): FakeFabricNode | undefined {
  for (const node of nodes) {
    if (node.props['tag'] === tag) return node;
    const hit = byTag(node.children, tag);
    if (hit) return hit;
  }
  return undefined;
}

const labels = (fabric: FakeFabric): string[] =>
  fabric
    .render()
    .split('\n')
    .flatMap((line) => line.match(/RawText "(.+)"/)?.[1] ?? []);

describe('incremental commit', () => {
  let Component: Type<unknown>;
  let fabric: FakeFabric;
  let app: MountResult;
  let instance: List;

  before(async () => {
    const mod = await compileFixture('fixtures/list.ts');
    Component = mod['List'] as Type<unknown>;
  });

  beforeEach(async () => {
    fabric = createFakeFabric();
    app = mount(1, Component, fabric);
    instance = app.componentRef.instance as List;
    await settle();
    fabric.reset();
  });

  it('creates every node once on mount and commits once', async () => {
    const fresh = createFakeFabric();
    const first = mount(1, Component, fresh);
    await settle();

    assert.equal(fresh.calls.completeRoot, 1, 'one commit for the initial mount');
    assert.ok(fresh.calls.createNode > 0, 'nodes were created');
    assert.equal(fresh.calls.cloneWithChildren, 0, 'nothing to clone on a first mount');
    assert.equal(fresh.calls.cloneWithProps, 0);
    assert.equal(fresh.calls.cloneWithChildrenAndProps, 0);

    first.applicationRef.destroy();
  });

  it('creates nothing on a prop-only update', async () => {
    instance.setStyle({ padding: 12 });
    await settle();

    assert.equal(fabric.calls.createNode, 0, 'no new shadow nodes');
    assert.equal(fabric.calls.cloneWithProps, 1, 'the changed node clones with new props only');
    assert.equal(byTag(fabric.committed, 'dynamic')?.props['padding'], 12);
  });

  it('sends removed props as null so Fabric does not keep them', async () => {
    instance.setStyle({ margin: 3 });
    await settle();

    const dynamic = byTag(fabric.committed, 'dynamic')!;
    assert.equal(dynamic.props['margin'], 3, 'new prop applied');
    assert.equal(dynamic.props['padding'], null, 'removed prop explicitly nulled');
  });

  it('reuses an unchanged sibling subtree by reference', async () => {
    const staticBefore = byTag(fabric.committed, 'static')!;
    const staticChildBefore = staticBefore.children[0]!;

    instance.setItems([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
      { id: 4, label: 'd' },
    ]);
    await settle();

    const staticAfter = byTag(fabric.committed, 'static')!;
    assert.equal(staticAfter, staticBefore, 'the untouched subtree is the same object');
    assert.equal(staticAfter.children[0], staticChildBefore, 'and so are its descendants');
  });

  it('creates only the inserted nodes on an insert', async () => {
    instance.setItems([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
      { id: 4, label: 'd' },
    ]);
    await settle();

    // One Paragraph plus its RawText child. Everything else is reused or cloned.
    assert.equal(fabric.calls.createNode, 2, 'only the new row is created');
    assert.deepEqual(labels(fabric), ['never changes', 'a', 'b', 'c', 'd']);
  });

  it('creates nothing on a move', async () => {
    instance.setItems([
      { id: 3, label: 'c' },
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ]);
    await settle();

    assert.equal(fabric.calls.createNode, 0, 'a reorder reuses every node');
    assert.deepEqual(labels(fabric), ['never changes', 'c', 'a', 'b']);
  });

  it('creates nothing on a remove', async () => {
    instance.setItems([{ id: 2, label: 'b' }]);
    await settle();

    assert.equal(fabric.calls.createNode, 0, 'a removal creates nothing');
    assert.deepEqual(labels(fabric), ['never changes', 'b']);
  });

  it('does not touch Fabric at all when nothing changed', async () => {
    app.applicationRef.tick();
    await settle();

    assert.equal(fabric.calls.completeRoot, 0, 'a clean tick does not commit');
    assert.equal(fabric.calls.createNode, 0);
  });
});
