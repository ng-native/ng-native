/**
 * The window grows ahead of the scroll while the JS thread is idle, so a fling lands on rows that
 * are already drawn, and keeps no more than `windowSize` viewports.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import {
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const ITEM_HEIGHT = 40;
// Ten rows a viewport.
const VIEWPORT = 400;
// The list's batch period: only its timers run on the fake clock, everything else on the real one.
const BATCH_MS = 50;

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** The first and last row rendered in the list, leaving out the hidden slots kept for reuse. */
function edges(fabric: FakeFabric): [number, number] {
  const shown = flatten(fabric.committed)
    .filter((node) => node.props['position'] === 'absolute' && node.props['opacity'] !== 0)
    .flatMap((row) => flatten(row.children))
    .map((node) => node.props['text'])
    .filter((text): text is string => typeof text === 'string')
    .map((text) => Number(text.slice('row '.length)));
  return [Math.min(...shown), Math.max(...shown)];
}

describe('windowed list filling while idle', () => {
  let Component: Type<unknown>;
  let fabric: FakeFabric;
  let host: FakeFabricNode;
  let instance: {
    windowSize: { set(value: number): void };
    list(): {
      scrollToIndex(options: { index: number }): void;
      scrollToOffset(options: { offset: number; animated?: boolean }): void;
      scrollToEnd(options?: { animated?: boolean }): void;
    };
  };
  let unmount: () => void;
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const pending = new Map<object, { at: number; run: () => void }>();
  let now = 0;

  /** Move the fake clock on, running the batches that come due, then let them commit. */
  async function advance(ms: number): Promise<void> {
    now += ms;
    for (const [handle, timer] of [...pending]) {
      if (timer.at > now) continue;
      pending.delete(handle);
      timer.run();
    }
    await settle();
  }

  /** Long enough for every batch the window can grow by to land. */
  async function idle(): Promise<void> {
    for (let batch = 0; batch < 8; batch++) await advance(BATCH_MS);
  }

  before(async () => {
    const mod = await compileFixture('fixtures/virtual.ts');
    Component = mod['Virtual'] as Type<unknown>;
  });

  beforeEach(async () => {
    now = 0;
    pending.clear();
    globalThis.setTimeout = ((run: () => void, ms?: number, ...args: unknown[]) => {
      if (ms !== BATCH_MS) return real.setTimeout(run, ms, ...args);
      const handle = {};
      pending.set(handle, { at: now + ms, run });
      return handle;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((handle: unknown) => {
      if (!pending.delete(handle as object)) real.clearTimeout(handle as NodeJS.Timeout);
    }) as typeof clearTimeout;
    const rendered = await render(Component);
    fabric = rendered.fabric;
    instance = rendered.instance as typeof instance;
    unmount = rendered.unmount;
    instance.windowSize.set(5);
    host = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(host, 'layout', { layout: { height: VIEWPORT } });
  });

  afterEach(() => {
    globalThis.setTimeout = real.setTimeout;
    globalThis.clearTimeout = real.clearTimeout;
  });

  const scrollTo = (row: number) =>
    fireEvent.scroll(host, { contentOffset: { y: row * ITEM_HEIGHT } });

  it('renders the overscan only, until the JS thread is free', async () => {
    await scrollTo(100);
    assert.deepEqual(edges(fabric), [98, 111]);
  });

  it('fills a viewport a batch, ahead of the scroll first', async () => {
    await scrollTo(100);
    // Rows 100 to 109 are on screen, and the viewport reaches into the row after them when it is
    // part way through row 100.
    await advance(BATCH_MS);
    assert.deepEqual(edges(fabric), [98, 120]);
    await advance(BATCH_MS);
    assert.deepEqual(edges(fabric), [98, 130]);
    await advance(BATCH_MS);
    assert.deepEqual(edges(fabric), [98, 140]);
    await advance(BATCH_MS);
    assert.deepEqual(edges(fabric), [90, 140], 'then one behind');
    await idle();
    assert.deepEqual(edges(fabric), [90, 140], 'and no further');
  });

  it('waits until the window stops changing', async () => {
    await scrollTo(100);
    await advance(BATCH_MS - 10);
    await scrollTo(101);
    await advance(BATCH_MS - 10);
    assert.deepEqual(edges(fabric), [99, 112]);
  });

  it('waits for a first layout', async () => {
    await fireEvent(host, 'layout', { layout: { height: 0 } });
    await idle();
    await fireEvent(host, 'layout', { layout: { height: VIEWPORT } });
    assert.deepEqual(edges(fabric), [0, 11]);
  });

  it('turns the fill around with the scroll', async () => {
    await scrollTo(100);
    await idle();
    await scrollTo(99);
    // What was ahead is cut to what is kept behind, at once; what was behind is kept.
    assert.deepEqual(edges(fabric), [89, 119]);
    await idle();
    assert.deepEqual(edges(fabric), [69, 119]);
  });

  it('does not bring back the rows it let go of when the scroll turns back', async () => {
    await scrollTo(100);
    await idle();
    await scrollTo(99);
    await scrollTo(100);
    assert.deepEqual(edges(fabric), [90, 120]);
  });

  it('keeps the fill when a scroll outruns the window', async () => {
    await scrollTo(100);
    await idle();
    await scrollTo(500);
    assert.deepEqual(edges(fabric), [490, 540]);
  });

  it('starts the fill over after scrollToIndex past the window', async () => {
    await scrollTo(100);
    await idle();
    instance.list().scrollToIndex({ index: 500 });
    await settle();
    assert.deepEqual(edges(fabric), [498, 511]);
  });

  it('starts the fill over after scrollToOffset past the window', async () => {
    await scrollTo(100);
    await idle();
    instance.list().scrollToOffset({ offset: 500 * ITEM_HEIGHT, animated: false });
    // Native reports the offset it moved to.
    await scrollTo(500);
    assert.deepEqual(edges(fabric), [498, 511]);
  });

  it('keeps the fill for a scrollToOffset inside the window', async () => {
    await scrollTo(100);
    await idle();
    instance.list().scrollToOffset({ offset: 105 * ITEM_HEIGHT, animated: false });
    await scrollTo(105);
    assert.deepEqual(edges(fabric), [95, 145]);
  });

  it('starts the fill over for a scrollToOffset to the row just past the window', async () => {
    await scrollTo(100);
    await idle();
    // Rows 90 to 140 are rendered.
    instance.list().scrollToOffset({ offset: 141 * ITEM_HEIGHT, animated: false });
    await scrollTo(141);
    assert.deepEqual(edges(fabric), [139, 152]);
  });

  it('starts the fill over after scrollToEnd', async () => {
    await scrollTo(100);
    await idle();
    instance.list().scrollToEnd({ animated: false });
    // The last viewport: rows 990 to 999.
    await scrollTo(990);
    assert.deepEqual(edges(fabric), [988, 999]);
  });

  it('follows windowSize up and down', async () => {
    instance.windowSize.set(1);
    await settle();
    await scrollTo(100);
    await idle();
    assert.deepEqual(edges(fabric), [98, 111], 'a windowSize of 1 fills nothing');
    instance.windowSize.set(5);
    await idle();
    assert.deepEqual(edges(fabric), [90, 140], 'raised, it fills while idle');
    instance.windowSize.set(1);
    await settle();
    assert.deepEqual(edges(fabric), [98, 111], 'lowered, it lets go of the fill at once');
    instance.windowSize.set(5);
    await settle();
    assert.deepEqual(edges(fabric), [98, 111], 'raised again, it fills a batch at a time');
    await advance(BATCH_MS);
    assert.deepEqual(edges(fabric), [98, 120]);
  });

  it('leaves no batch waiting once destroyed', async () => {
    await scrollTo(100);
    assert.equal(pending.size, 1);
    unmount();
    assert.equal(pending.size, 0);
  });

  it('stops at the end of the list', async () => {
    await scrollTo(985);
    await idle();
    assert.deepEqual(edges(fabric), [975, 999]);
  });
});
