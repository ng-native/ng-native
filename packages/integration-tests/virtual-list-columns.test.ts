/**
 * `virtual-list[virtualListNumColumns]`: FlatList's `numColumns`, items side by side a line at a
 * time, on the one list rather than a second component.
 *
 * Each item is still its own window entry and its own slot, so recycling, keys and the caller's
 * `@for` are what they are for a plain list. What changes is placement: items share a line, the
 * line is as tall as its tallest item, and each item is inset across the width to its column.
 *
 * The geometry throughout: a list 300 wide and 400 tall, items 40 high, three to a line, so 100
 * items make 34 lines. Where an item sits across the width is read back from the props it commits,
 * resolved against the width the way Yoga would: `x` and `width` below.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { Direction } from '@ng-native/device';
import {
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const WIDTH = 300;
const VIEWPORT = 400;

interface Instance {
  list(): { scrollToIndex(options: { index: number; animated?: boolean }): void };
  height: WritableSignal<unknown>;
  padding: WritableSignal<unknown>;
  rowGap: WritableSignal<number>;
  columns: WritableSignal<number>;
  columnGap: WritableSignal<number>;
  sticky: WritableSignal<readonly number[]>;
  horizontal: WritableSignal<boolean>;
  viewable: () => readonly number[];
}

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/virtual-columns.ts');
});

describe('a windowed list in columns', () => {
  it('lays items out side by side, a line of them at a time', async () => {
    const { tile } = await boot();
    for (const [index, line] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 1],
      [5, 1],
      [6, 2],
    ] as const) {
      assert.equal(tile(index)?.props['top'], line * 40, `tile ${index} is on line ${line}`);
      assert.equal(tile(index)?.props['height'], 40);
    }
    assert.deepEqual(
      [0, 1, 2].map((index) => across(tile(index)!)),
      [
        { x: 0, width: 100 },
        { x: 100, width: 100 },
        { x: 200, width: 100 },
      ],
    );
  });

  it('sizes the content to its lines', async () => {
    const { canvas } = await boot();
    // 33 full lines, and one with a single tile on it.
    assert.equal(canvas().props['height'], 34 * 40);
  });

  it('spaces the columns by the column gap and insets them by the padding', async () => {
    const { tile, canvas } = await boot((page) => {
      page.padding.set({ top: 20, right: 12, bottom: 30, left: 8 });
      page.rowGap.set(10);
      page.columnGap.set(6);
    });
    // 300, less 8 and 12 of padding and two gaps of 6, is three columns of 268 / 3.
    const column = 268 / 3;
    assert.deepEqual(
      [0, 1, 2].map((index) => across(tile(index)!)),
      [
        { x: 8, width: round(column) },
        { x: round(8 + column + 6), width: round(column) },
        { x: round(8 + 2 * (column + 6)), width: round(column) },
      ],
    );
    assert.equal(tile(3)?.props['top'], 20 + 50);
    assert.equal(canvas().props['height'], 20 + 34 * 40 + 33 * 10 + 30);
  });

  it('renders the lines on screen and the overscan, and no further', async () => {
    const { shown, scroll } = await boot();
    await scroll(20 * 40);
    // Lines 20 to 29 fill the viewport, with a line of overscan either side.
    assert.deepEqual(shown(), range(19 * 3, 31 * 3));
  });

  it('makes a line as tall as its tallest item, and stretches the others to it', async () => {
    const { tile, canvas } = await boot((page) => {
      page.height.set((_: unknown, index: number) => (index === 4 ? 100 : 40));
    });
    assert.equal(tile(3)?.props['height'], 100);
    assert.equal(tile(4)?.props['height'], 100);
    assert.equal(tile(6)?.props['top'], 140);
    assert.equal(canvas().props['height'], 33 * 40 + 100);
  });

  it('gives a sticky row a whole line, and starts a new line after it', async () => {
    const { tile, canvas } = await boot((page) => page.sticky.set([0, 10]));
    assert.deepEqual(across(tile(0)!), { x: 0, width: WIDTH });
    assert.equal(tile(1)?.props['top'], 40);
    assert.deepEqual(across(tile(1)!), { x: 0, width: 100 });
    // Tiles 1 to 9 are three lines, then tile 10 has a line to itself.
    assert.equal(tile(10)?.props['top'], 160);
    assert.deepEqual(across(tile(10)!), { x: 0, width: WIDTH });
    assert.equal(tile(11)?.props['top'], 200);
    assert.deepEqual(across(tile(11)!), { x: 0, width: 100 });
    // The 89 tiles after it are 29 full lines and one of two.
    assert.equal(canvas().props['height'], (1 + 3 + 1 + 30) * 40);
  });

  it('pins a sticky line across the whole width while the grid scrolls under it', async () => {
    const { tile, scroll } = await boot((page) => page.sticky.set([0, 10]));
    await scroll(100);
    assert.equal(tile(0)?.props['zIndex'], 1);
    assert.equal(tile(0)?.props['top'], 100, 'held at the leading edge');
    assert.deepEqual(across(tile(0)!), { x: 0, width: WIDTH });
  });

  it('scrolls to the line an index is on', async () => {
    const { instance, fabric } = await boot();
    const before = fabric.commands.length;
    instance.list().scrollToIndex({ index: 31, animated: false });
    assert.deepEqual(fabric.commands.slice(before).at(-1), {
      viewName: 'ScrollView',
      name: 'scrollTo',
      args: [0, 10 * 40, false],
    });
  });

  it('announces each item of a line that is on screen far enough', async () => {
    const { instance, scroll } = await boot();
    await scroll(20);
    // Half of the first line and half of the eleventh are on screen, which is the threshold.
    assert.deepEqual(instance.viewable(), range(0, 33));
    await scroll(30);
    assert.deepEqual(instance.viewable(), range(3, 33));
  });

  it('lays out a new column count', async () => {
    const { instance, tile } = await boot();
    instance.columns.set(4);
    await settle();
    assert.equal(tile(3)?.props['top'], 0);
    assert.deepEqual(across(tile(3)!), { x: 225, width: 75 });
    assert.equal(tile(4)?.props['top'], 40);
    assert.deepEqual(across(tile(4)!), { x: 0, width: 75 });
  });

  it('renders down to the viewport s end when a new count moves the top item onto a shorter line', async () => {
    // Tile 4 is 1000 high, so at 940 the viewport is 900 into line 1 (tiles 3 to 5). In two
    // columns tile 3 is on a 40-high line: the list must window from the line now at the top.
    const { instance, shown, scroll } = await boot((page) => {
      page.height.set((_: unknown, index: number) => (index === 4 ? 1000 : 40));
    });
    await scroll(940);
    instance.columns.set(2);
    await settle();
    // Lines 2 (tiles 4 and 5) to 9 (tiles 18 and 19) cover 940 to 1340.
    for (const index of [4, 5, 12, 18, 19]) {
      assert.ok(shown().includes(index), `tile ${index} is rendered`);
    }
  });

  it('announces what is viewable after a new count, with no scroll', async () => {
    const { instance } = await boot();
    assert.deepEqual(instance.viewable(), range(0, 30));
    instance.columns.set(4);
    await settle();
    assert.deepEqual(instance.viewable(), range(0, 40));
  });

  it('puts the items back a line each, across the width, with one column', async () => {
    const { instance, tile, canvas } = await boot((page) => page.columnGap.set(6));
    instance.columns.set(1);
    await settle();
    assert.equal(tile(1)?.props['top'], 40);
    assert.equal(canvas().props['height'], 100 * 40);
    for (const prop of ['left', 'right']) assert.equal(tile(1)?.props[prop], 0);
    for (const prop of ['start', 'end', 'marginStart', 'marginEnd']) {
      assert.equal(tile(1)?.props[prop] ?? null, null, `${prop} is taken off`);
    }
  });

  it('places columns by logical sides, so layout puts the first on the right in right to left', async () => {
    // React Native mirrors left and right in a right-to-left layout, so physical sides chosen by
    // direction here would be mirrored twice. Start and end are resolved once, by layout.
    const { tile } = await boot(undefined, {
      providers: [
        {
          provide: Direction.SOURCE,
          useValue: { current: () => 'rtl', subscribe: () => () => {} },
        },
      ],
    });
    for (const prop of ['left', 'right', 'marginLeft', 'marginRight']) {
      assert.equal(tile(0)?.props[prop], undefined, `no ${prop}`);
    }
    assert.equal(tile(0)?.props['start'], '0%');
    assert.equal(tile(2)?.props['end'], '0%');
  });

  it('keeps a horizontal list to one item a line, and says why in development', async () => {
    const warnings = await warned(async () => {
      const { tile } = await boot((page) => page.horizontal.set(true));
      assert.equal(tile(1)?.props['left'], 40);
    });
    assert.equal(warnings.filter((line) => line.includes('virtualListNumColumns')).length, 1);
  });

  it('keeps rows that size themselves to one a line, and says why in development', async () => {
    const warnings = await warned(async () => {
      const { tile } = await boot(undefined, {}, 'VirtualColumnsMeasured');
      assert.equal(tile(1)?.props['position'], undefined, 'in flow, under the first');
    });
    assert.equal(warnings.filter((line) => line.includes('virtualListNumColumns')).length, 1);
  });
});

async function boot(
  setUp?: (instance: Instance) => void,
  options: Parameters<typeof render>[1] = {},
  name = 'VirtualColumns',
) {
  const rendered = await render(mod[name] as Type<unknown>, options);
  const fabric: FakeFabric = rendered.fabric;
  const instance = rendered.instance as Instance;
  if (setUp) {
    setUp(instance);
    await settle();
  }
  const scrollView = () => flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
  await fireEvent(scrollView(), 'layout', { layout: { width: WIDTH, height: VIEWPORT } });
  const tiles = () =>
    flatten(fabric.committed).filter((n) => /^tile\d+$/.test(String(n.props['nativeID'] ?? '')));
  const tile = (index: number) => tiles().find((n) => n.props['nativeID'] === `tile${index}`);
  // Inside the content view the header slot comes first; the canvas carries the list's extent.
  const canvas = () => scrollView().children[0]!.children[1]!;
  const scroll = (y: number) => fireEvent.scroll(scrollView(), { contentOffset: { y } });
  /** The tiles in the window, without the ones parked off screen for reuse. */
  const shown = () =>
    tiles()
      .filter((n) => !String(n.props['transform'] ?? '').includes('-100000'))
      .map((n) => Number(String(n.props['nativeID']).slice(4)))
      .sort((a, b) => a - b);
  return { fabric, instance, tile, canvas, scroll, shown };
}

/**
 * Where a slot sits across the list, from its insets, as Yoga resolves them against the width in
 * a left-to-right layout: a column's start and end, or a full line's left and right.
 */
function across(node: FakeFabricNode): { x: number; width: number } {
  const side = (physical: string, logical: string) =>
    resolve(node.props[physical] ?? node.props[logical]);
  const left = side('left', 'start') + side('marginLeft', 'marginStart');
  const right = side('right', 'end') + side('marginRight', 'marginEnd');
  return { x: round(left), width: round(WIDTH - left - right) };
}

function resolve(value: unknown): number {
  if (typeof value === 'string' && value.endsWith('%')) return (parseFloat(value) * WIDTH) / 100;
  return typeof value === 'number' ? value : 0;
}

/** Percentages of a third do not come out whole. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

async function warned(run: () => Promise<void>): Promise<string[]> {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
  try {
    await run();
  } finally {
    console.warn = warn;
  }
  return warnings;
}

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}
