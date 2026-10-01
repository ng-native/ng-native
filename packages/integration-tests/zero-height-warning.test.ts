/**
 * A scroll view or a virtual list laid out at zero height, in development: the usual sign of a
 * component host left without `flex: 1`, which renders nothing and says nothing.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { render, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

const scrollOf = (fabric: FakeFabric): FakeFabricNode =>
  flatten(fabric.committed).find((node) => node.viewName === 'ScrollView')!;

/** A layout event on a node, with a height and a width. */
const lay = (fabric: FakeFabric, node: FakeFabricNode, height: number) =>
  fabric.emit(node, 'topLayout', { layout: { x: 0, y: 0, width: 400, height } });

describe('a scroll view or virtual list at zero height, in development', () => {
  let ZeroScroll: Type<unknown>;
  let ZeroList: Type<unknown>;
  let ZeroEmptyList: Type<unknown>;
  let warnings: string[];

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/zero-height.ts', import.meta.url)),
    );
    ZeroScroll = mod['ZeroScroll'] as Type<unknown>;
    ZeroList = mod['ZeroList'] as Type<unknown>;
    ZeroEmptyList = mod['ZeroEmptyList'] as Type<unknown>;
  });

  beforeEach(() => {
    warnings = [];
    mock.method(console, 'warn', (message: string) => warnings.push(message));
  });

  afterEach(() => {
    mock.restoreAll();
    mock.timers.reset();
  });

  /** Renders, then takes over the clock, so a test decides when a second has passed. */
  async function rendered(component: Type<unknown>) {
    mock.timers.reset();
    const result = await render(component);
    mock.timers.enable({ apis: ['setTimeout'] });
    return result;
  }

  /** As a release build is: Angular's `ngDevMode` is false there. */
  async function released<T>(run: () => Promise<T>): Promise<T> {
    const scope = globalThis as { ngDevMode?: unknown };
    const before = scope.ngDevMode;
    scope.ngDevMode = false;
    try {
      return await run();
    } finally {
      scope.ngDevMode = before;
    }
  }

  it('warns about a scroll view with content that stays at zero height', async () => {
    const { fabric } = await rendered(ZeroScroll);
    const scroll = scrollOf(fabric);
    lay(fabric, scroll.children[0]!, 120);
    lay(fabric, scroll, 0);
    mock.timers.tick(1000);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /<scroll-view class="feed">/);
    assert.match(warnings[0]!, /flex: 1/);
    assert.match(warnings[0]!, /ng-native\.com\/packages\/components\/layout/);
  });

  it('says nothing of one that grows within a second, or has a height', async () => {
    const growing = await rendered(ZeroScroll);
    const scroll = scrollOf(growing.fabric);
    lay(growing.fabric, scroll.children[0]!, 120);
    lay(growing.fabric, scroll, 0);
    lay(growing.fabric, scroll, 300);
    mock.timers.tick(1000);
    assert.deepEqual(warnings, []);
  });

  it('says nothing of a scroll view with no content', async () => {
    const { fabric } = await rendered(ZeroScroll);
    const scroll = scrollOf(fabric);
    lay(fabric, scroll.children[0]!, 0);
    lay(fabric, scroll, 0);
    mock.timers.tick(1000);
    assert.deepEqual(warnings, []);
  });

  it('warns about a virtual list with rows that stays at zero height', async () => {
    const { fabric } = await rendered(ZeroList);
    lay(fabric, scrollOf(fabric), 0);
    mock.timers.tick(1000);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /<virtual-list class="feed">/);
  });

  it('says nothing of an empty virtual list', async () => {
    const { fabric } = await rendered(ZeroEmptyList);
    lay(fabric, scrollOf(fabric), 0);
    mock.timers.tick(1000);
    assert.deepEqual(warnings, []);
  });

  it('says nothing of a virtual list with a height', async () => {
    const { fabric } = await rendered(ZeroList);
    lay(fabric, scrollOf(fabric), 400);
    mock.timers.tick(1000);
    assert.deepEqual(warnings, []);
  });

  it('says nothing once the element is destroyed', async () => {
    const { fabric, componentRef } = await rendered(ZeroScroll);
    const scroll = scrollOf(fabric);
    lay(fabric, scroll.children[0]!, 120);
    lay(fabric, scroll, 0);
    componentRef.destroy();
    mock.timers.tick(1000);
    assert.deepEqual(warnings, []);
  });

  it('costs a release build nothing: no layout listener on a scroll view, and no warning', () =>
    released(async () => {
      const { fabric } = await rendered(ZeroScroll);
      const scroll = scrollOf(fabric);
      assert.equal(scroll.props['onLayout'], undefined);
      lay(fabric, scroll.children[0]!, 120);
      lay(fabric, scroll, 0);
      mock.timers.tick(1000);
      assert.deepEqual(warnings, []);
    }));

  it('says nothing of a virtual list at zero height in a release build', () =>
    released(async () => {
      const { fabric } = await rendered(ZeroList);
      lay(fabric, scrollOf(fabric), 0);
      mock.timers.tick(1000);
      assert.deepEqual(warnings, []);
    }));
});
