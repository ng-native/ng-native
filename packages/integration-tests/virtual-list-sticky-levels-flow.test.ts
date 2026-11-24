/**
 * `virtual-list[virtualListStickyLevel]` on rows that size themselves: the year, its month and its
 * day pinned one under the other, where the list knows each row's height only once it is measured.
 *
 * The geometry is `virtual-list-sticky-levels.test.ts`'s: a list 400 along its axis, a year's row
 * 50, a month's 40, a day's 30 and an entry 40, each reported as native would once laid out. Year
 * `y` is row `58y`, its month `m` row `58y + 1 + 19m` and that month's day `d` row `58y + 2 + 19m +
 * 6d`. `top` below is where a row starts.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import type { Type } from '@angular/core';
import { fireEvent, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { recorder } from './native-animated.ts';

const WIDTH = 300;
const VIEWPORT = 400;
const SIZES = [50, 40, 30];
const ENTRY = 40;

interface Entry {
  readonly id: number;
  readonly level: number | null;
}

let mod: Record<string, unknown>;
let entries: () => Entry[];
before(async () => {
  mod = await compileFixture('fixtures/virtual-sticky-levels.ts');
  entries = mod['entries'] as () => Entry[];
});

describe('sticky levels on rows that size themselves, placed from JavaScript', () => {
  it('pins a month under its year, and a day under both', async () => {
    const { drawn, scroll } = await boot();
    await scroll(650);
    assert.deepEqual([0, 1, 14].map(drawn), [650, 700, 740]);
    assert.equal(drawn(15), top(15), 'the entries scroll under them, at their own places');
  });

  it('renders each pinned row the window has left behind', async () => {
    const { shown, scroll } = await boot();
    await scroll(650);
    for (const index of [0, 1, 14]) assert.ok(shown().includes(index), `row ${index}`);
  });

  it('draws a pinned row over the rows pinned under it, and those over the rest', async () => {
    const { row, scroll } = await boot();
    await scroll(650);
    const z = (index: number) => Number(row(index)?.props['zIndex'] ?? 0);
    assert.ok(z(0) > z(1) && z(1) > z(14) && z(14) > z(15));
  });

  it('pushes a day off with the next day, sliding it under the month, which stays', async () => {
    const { drawn, scroll } = await boot();
    // Day 0.0.0 holds under the year and the month until day 0.0.1's top reaches its far edge.
    await scroll(220);
    assert.deepEqual([0, 1].map(drawn), [220, 270]);
    assert.equal(drawn(2), top(8) - SIZES[2]!, 'pushed up by the next day');
    assert.equal(drawn(8), top(8));
  });

  it('pins the deeper levels again where a row is measured taller', async () => {
    const { drawn, scroll, measure } = await boot();
    await scroll(650);
    await measure(0, 70);
    await scroll(655);
    assert.deepEqual([0, 1, 14].map(drawn), [655, 725, 765]);
  });
});

describe('sticky levels on rows that size themselves, moved on the native side', () => {
  // Measuring rows can outlast the scroll pause on a slow runner. Keep Angular's zero-delay
  // scheduling, but hold delayed callbacks while a test is asserting an ongoing scroll.
  const holdDelayedTimers = () => {
    const setTimeout_ = globalThis.setTimeout;
    return mock.method(globalThis, 'setTimeout', ((callback: () => void, delay?: number) =>
      delay ? undefined : setTimeout_(callback, delay)) as typeof setTimeout);
  };

  it('leaves each row at its own place, moved from where it meets the rows it pins under', async () => {
    const { native, drives } = recorder();
    const { row, placed, scroll } = await boot({ nativeAnimated: native });
    const held = holdDelayedTimers();
    try {
      await scroll(650);
      const range = (index: number) => drives().get(row(index)!.reactTag)?.inputRange;
      assert.deepEqual([0, 1, 14, 15].map(placed), [0, top(1), top(14), top(15)]);
      // The year's end is where the next year starts by the rows' estimates, not measured yet.
      assert.equal(range(0)?.[0], 0);
      assert.deepEqual(range(1), [top(1) - 50, top(20) - 40 - 50]);
      assert.deepEqual(range(14), [top(14) - 90, top(20) - 30 - 90]);
    } finally {
      held.mock.restore();
    }
  });

  it('leaves the props of every pinned row alone as the window moves past them', async () => {
    // Fabric applying new props to a view native is moving puts its transform back to the one in
    // the props, and the row jumps for a frame.
    const { native } = recorder();
    const { row, scroll, window } = await boot({ nativeAnimated: native });
    const held = holdDelayedTimers();
    try {
      await scroll(470);
      const before = [0, 1, 14].map((index) => row(index)!.props);
      assert.ok(
        window().some((r) => r.index === 12),
        'the day is in the window',
      );
      for (let y = 480; y <= 650; y += 10) await scroll(y);
      assert.ok(
        window().every((r) => r.index > 14 || [0, 1, 13, 14].includes(r.index)),
        'and the window has moved past it',
      );
      assert.deepEqual(
        [0, 1, 14].map((index, at) => row(index)!.props === before[at]),
        [true, true, true],
      );
    } finally {
      held.mock.restore();
    }
  });

  it('leaves each row at its own place where the rows skipped overlap by a negative rowGap', async () => {
    // Day 2's entries, rows 3 to 6, shorter than the gap: the rows skipped between the month and
    // the row before day 8 come to less than nothing.
    const gap = -20;
    const short = new Map([3, 4, 5, 6].map((index) => [index, 5]));
    const at = (index: number) => {
      let sum = 0;
      for (let k = 0; k < index; k++) sum += (short.get(k) ?? size(k)) + gap;
      return sum;
    };
    const { native } = recorder();
    const { placed, scroll, measure, window } = await boot({ nativeAnimated: native }, gap);
    const held = holdDelayedTimers();
    try {
      for (const [index, height] of short) await measure(index, height);
      // Day 8 pinned, under the year and the month, with the window just past it.
      await scroll(at(9) + 5);
      const rendered = window().map((r) => r.index);
      assert.ok(rendered.includes(7) && !rendered.includes(6), 'the rows before 7 are skipped');
      assert.deepEqual(rendered.map(placed), rendered.map(at));
    } finally {
      held.mock.restore();
    }
  });

  it('places the deeper levels again where a pinned row is measured taller', async () => {
    const { native, drives } = recorder();
    const { row, scroll, measure } = await boot({ nativeAnimated: native });
    const held = holdDelayedTimers();
    try {
      await scroll(650);
      await measure(0, 70);
      const range = (index: number) => drives().get(row(index)!.reactTag)?.inputRange;
      assert.deepEqual(range(1), [top(1) + 20 - 70, top(20) + 20 - 40 - 70]);
      assert.deepEqual(range(14), [top(14) + 20 - 110, top(20) + 20 - 30 - 110]);
    } finally {
      held.mock.restore();
    }
  });
});

describe('sticky levels on rows that size themselves, in development', () => {
  it('says nothing about the levels it pins', async () => {
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
    try {
      await boot();
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(
      warnings.filter((line) => line.includes('virtualListStickyLevel')),
      [],
    );
  });
});

async function boot(options: Parameters<typeof render>[1] = {}, gap = 0) {
  const rendered = await render(mod['VirtualStickyLevelsFlow'] as Type<unknown>, options);
  const fabric = rendered.fabric;
  const instance = rendered.instance as {
    list(): { window(): { index: number; parked?: boolean }[] };
    rowGap: { set(gap: number): void };
  };
  instance.rowGap.set(gap);
  await settle();
  const scrollView = () => flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
  await fireEvent(scrollView(), 'layout', { layout: { width: WIDTH, height: VIEWPORT } });
  const rows = () =>
    flatten(fabric.committed).filter(
      (n) => /^row\d+$/.test(String(n.props['nativeID'] ?? '')) && n.props['opacity'] !== 0,
    );
  const indexOf = (node: FakeFabricNode) => Number(String(node.props['nativeID']).slice(3));
  const row = (index: number) => rows().find((n) => indexOf(n) === index);
  const shown = () =>
    rows()
      .map(indexOf)
      .sort((a, b) => a - b);
  const sizes = new Map<number, number>();
  const sizeOf = (index: number) => sizes.get(index) ?? size(index);
  const measure = async (index: number, height: number) => {
    sizes.set(index, height);
    await fireEvent(row(index)!, 'layout', { layout: { x: 0, y: 0, width: WIDTH, height } });
  };
  /** Measure every rendered row, and those a measurement brings into the window. */
  const measureAll = async () => {
    const done = new Set<number>();
    for (let pending = shown(); pending.length;) {
      for (const index of pending) {
        done.add(index);
        const node = row(index);
        if (node) {
          await fireEvent(node, 'layout', {
            layout: { x: 0, y: 0, width: WIDTH, height: sizeOf(index) },
          });
        }
      }
      pending = shown().filter((index) => !done.has(index));
    }
  };
  const canvas = () => scrollView().children[0]!.children[1]!;
  /** Where flow puts a row: after the spacer and each row before it, with their margins. */
  const placed = (index: number): number | undefined => {
    const [spacer, ...children] = canvas().children;
    let along = Number(spacer!.props['height'] ?? 0);
    for (const child of children) {
      if (child.props['position'] === 'absolute' || child.props['opacity'] === 0) continue;
      along += Number(child.props['marginTop'] ?? 0);
      if (/^row\d+$/.test(String(child.props['nativeID'])) && indexOf(child) === index)
        return along;
      along += sizeOf(indexOf(child)) + Number(child.props['marginBottom'] ?? 0);
    }
    return undefined;
  };
  /** Where a row placed from JavaScript is drawn: where flow puts it, moved by its transform. */
  const drawn = (index: number) => {
    const transform = (row(index)?.props['transform'] ?? []) as { translateY?: number }[];
    return (placed(index) ?? NaN) + transform.reduce((sum, t) => sum + (t.translateY ?? 0), 0);
  };
  const scroll = async (y: number) => {
    await fireEvent.scroll(scrollView(), { contentOffset: { y } });
    await measureAll();
    await settle();
  };
  await measureAll();
  return {
    row,
    shown,
    placed,
    drawn,
    measure,
    scroll,
    window: () =>
      instance
        .list()
        .window()
        .filter((r) => !r.parked),
  };
}

function size(index: number): number {
  return SIZES[entries()[index]!.level ?? -1] ?? ENTRY;
}

/** Where a row starts along the list. */
function top(index: number): number {
  let sum = 0;
  for (let at = 0; at < index; at++) sum += size(at);
  return sum;
}

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}
