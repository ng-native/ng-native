/**
 * The window reaches ahead of a fast scroll by `velocityLead` milliseconds of its speed, so a fling
 * lands on rows already drawn rather than on rows a window change has yet to bring.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
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

describe('windowed list reaching ahead of the scroll', () => {
  let Component: Type<unknown>;
  let fabric: FakeFabric;
  let host: FakeFabricNode;
  let instance: {
    velocityLead: { set(value: number): void };
    list(): {
      scrollToIndex(options: { index: number; animated?: boolean }): void;
      scrollToOffset(options: { offset: number; animated?: boolean }): void;
    };
  };
  let unmount: () => void;
  let now = 1000;

  before(async () => {
    const mod = await compileFixture('fixtures/virtual.ts');
    Component = mod['Virtual'] as Type<unknown>;
  });

  beforeEach(async () => {
    now = 1000;
    mock.method(performance, 'now', () => now);
    const rendered = await render(Component);
    fabric = rendered.fabric;
    instance = rendered.instance as typeof instance;
    unmount = rendered.unmount;
    instance.velocityLead.set(500);
    host = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(host, 'layout', { layout: { height: VIEWPORT } });
  });

  afterEach(() => {
    unmount();
    mock.restoreAll();
  });

  /** One scroll event a frame, `rows` rows each, from row `from`; ends on the last row reached. */
  async function fling(from: number, rows: number, frames: number): Promise<number> {
    let row = from;
    for (let frame = 0; frame < frames; frame++) {
      row += rows;
      now += 16;
      await fireEvent.scroll(host, { contentOffset: { y: row * ITEM_HEIGHT } });
    }
    return row;
  }

  it('renders past the viewport in the direction of a fling', async () => {
    // A row a frame: 2.5 points a millisecond, 1250 points of lead at 500ms, capped at 3 viewports.
    const at = await fling(100, 1, 10);
    const [first, last] = edges(fabric);
    assert.ok(last >= at + 10 + 20, `rows to ${last}, past the viewport ending at ${at + 10}`);
    assert.ok(last <= at + 10 + 30 + 3, `but no more than three viewports past it: ${last}`);
    assert.ok(first >= at - 3, `and nothing extra behind: ${first}`);
  });

  it('renders before the viewport for a fling toward the start', async () => {
    const at = await fling(500, -1, 10);
    const [first, last] = edges(fabric);
    assert.ok(first <= at - 20, `rows from ${first}, before the viewport at ${at}`);
    assert.ok(last <= at + 10 + 3, `and nothing extra after it: ${last}`);
  });

  it('reaches further for a faster fling', async () => {
    // Past the overscan, which ends 11 rows after the row at the top.
    const reach = (at: number) => edges(fabric)[1] - (Math.floor(at) + 11);
    const slow = reach(await fling(100, 0.25, 10));
    now += 1000;
    const fast = reach(await fling(100, 1, 10));
    assert.ok(slow > 0, `a quarter of a row a frame reaches past the overscan: ${slow}`);
    assert.ok(fast > slow, `and a row a frame further: ${fast} against ${slow}`);
  });

  it('stops reaching ahead once the scroll pauses', async () => {
    const at = await fling(100, 1, 10);
    now += 1000;
    await fireEvent.scroll(host, { contentOffset: { y: at * ITEM_HEIGHT } });
    assert.ok(edges(fabric)[1] <= at + 10 + 3, `back to the overscan: ${edges(fabric)[1]}`);
  });

  it('stops reaching ahead when the scroll stops with no event to say so', async () => {
    // A drag held still sends nothing more, as a fling that ends does not either.
    const at = await fling(100, 1, 10);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle();
    assert.ok(edges(fabric)[1] <= at + 10 + 3, `back to the overscan: ${edges(fabric)[1]}`);
  });

  it('reads the speed from native s timestamps, when events reach JavaScript all at once', async () => {
    // A JS thread that fell behind gets a fling's events in a burst: one arrival time for all.
    let row = 100;
    for (let frame = 0; frame < 10; frame++) {
      row += 1;
      await fireEvent.scroll(host, {
        contentOffset: { y: row * ITEM_HEIGHT },
        timestamp: 5000 + frame * 16,
      });
    }
    const last = edges(fabric)[1];
    assert.ok(last >= row + 10 + 20, `rows to ${last}, past the viewport ending at ${row + 10}`);
  });

  it('follows a turn the other way', async () => {
    const at = await fling(300, 1, 10);
    await fling(at, -1, 6);
    const [first] = edges(fabric);
    assert.ok(first <= at - 6 - 10, `rows reach back to ${first} after turning at ${at}`);
  });

  it('renders the overscan only with velocityLead 0', async () => {
    instance.velocityLead.set(0);
    const at = await fling(100, 1, 10);
    assert.deepEqual(edges(fabric), [at - 2, at + 11]);
  });

  it('stops reaching ahead when velocityLead is set to 0 mid-fling', async () => {
    const at = await fling(100, 1, 10);
    instance.velocityLead.set(0);
    await settle();
    assert.deepEqual(edges(fabric), [at - 2, at + 11]);
  });

  for (const how of ['scrollToIndex', 'scrollToOffset'] as const) {
    it(`does not read a ${how} jump as a fling`, async () => {
      await fling(100, 1, 10);
      now += 16;
      const list = instance.list();
      if (how === 'scrollToIndex') list.scrollToIndex({ index: 800, animated: false });
      else list.scrollToOffset({ offset: 800 * ITEM_HEIGHT, animated: false });
      // Native reports where the jump landed, a frame later.
      now += 16;
      await fireEvent.scroll(host, { contentOffset: { y: 800 * ITEM_HEIGHT } });
      assert.ok(edges(fabric)[1] <= 811 + 3, `the overscan past row 800: ${edges(fabric)[1]}`);
    });
  }
});
