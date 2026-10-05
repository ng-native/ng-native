/**
 * Padding around a windowed list's rows and a gap between them, as FlatList's
 * `contentContainerStyle` padding and FlashList's gap give.
 *
 * The rows are placed by the list itself, at offsets from its own table, so native padding and gap
 * on the canvas would move nothing: absolutely positioned rows ignore both, and rows in flow would
 * get a gap after the spacer too. Every place an offset is worked out has to count them instead,
 * which is what each test here pins.
 *
 * The geometry throughout: rows 40 high, a gap of 10, so a stride of 50; padding 20 at the top,
 * 12 on the right, 30 at the bottom and 8 on the left. Row `i` starts at 20 + 50i, and 100 rows
 * make 20 + 100 * 40 + 99 * 10 + 30 = 5040.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import {
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { recorder } from './native-animated.ts';

const VIEWPORT = 400;
const topOf = (index: number) => 20 + 50 * index;

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

interface Instance {
  list(): { scrollToIndex(options: { index: number; animated?: boolean }): void };
  padding: { set(value: unknown): void };
  gap: { set(value: number): void };
  horizontal?: { set(value: boolean): void };
  sticky: { set(value: readonly number[]): void };
  viewable?: () => readonly number[];
  ends?: number[];
}

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/virtual-spaced.ts', import.meta.url)),
  );
});

async function boot(name: string, options: Parameters<typeof render>[1] = {}) {
  const rendered = await render(mod[name] as Type<unknown>, options);
  const fabric: FakeFabric = rendered.fabric;
  const instance = rendered.instance as Instance;
  const scrollView = () => flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
  await fireEvent(scrollView(), 'layout', { layout: { width: VIEWPORT, height: VIEWPORT } });
  const row = (index: number) =>
    flatten(fabric.committed).find((n) => n.props['nativeID'] === `row${index}`);
  // Inside the content view the header slot comes first; the canvas is the view carrying the list's extent.
  const canvas = () => scrollView().children[0]!.children[1]!;
  const scroll = (y: number) => fireEvent.scroll(scrollView(), { contentOffset: { y } });
  return { fabric, instance, scrollView, row, canvas, scroll };
}

describe('a windowed list with padding and a gap', () => {
  it('places each row after the leading padding, one row and one gap apart', async () => {
    const { row } = await boot('VirtualSpaced');
    assert.equal(row(0)?.props['top'], 20);
    assert.equal(row(1)?.props['top'], 70);
    assert.equal(row(5)?.props['top'], topOf(5));
    assert.equal(row(1)?.props['height'], 40, 'the gap is outside the row');
  });

  it('insets each row by the padding across the axis', async () => {
    const { row } = await boot('VirtualSpaced');
    assert.equal(row(0)?.props['left'], 8);
    assert.equal(row(0)?.props['right'], 12);
  });

  it('sizes the content to the rows, the gaps between them and the padding at both ends', async () => {
    const { canvas } = await boot('VirtualSpaced');
    assert.equal(canvas().props['height'], 5040);
  });

  it('takes one number for padding on every side', async () => {
    const { instance, row, canvas } = await boot('VirtualSpaced');
    instance.padding.set(16);
    await settle();
    assert.equal(row(0)?.props['top'], 16);
    assert.equal(row(0)?.props['left'], 16);
    assert.equal(row(0)?.props['right'], 16);
    assert.equal(canvas().props['height'], 16 + 4000 + 990 + 16);
  });

  it('renders the rows the offset reaches, counting the padding and the gaps above them', async () => {
    const { scroll, row } = await boot('VirtualSpaced');
    await scroll(topOf(40));
    assert.ok(row(40), 'row 40 is on screen');
    assert.ok(row(38), 'with the overscan above it');
    assert.equal(row(37), undefined, 'and nothing further up');
    // In the gap after row 40, row 40 is still the first one counted as on screen.
    await scroll(topOf(40) + 45);
    assert.equal(row(37), undefined);
    assert.ok(row(38));
  });

  it('announces as viewable only the rows the padding and gaps leave on screen', async () => {
    const { instance } = await boot('VirtualSpaced');
    // Row 7 spans 370 to 410, so 30 of its 40 points show: past the threshold of a half. Row 8
    // starts at 420, past the viewport.
    assert.deepEqual(instance.viewable!(), [0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('scrolls to an index at its padded, gapped offset', async () => {
    const { instance, fabric } = await boot('VirtualSpaced');
    instance.list().scrollToIndex({ index: 10, animated: false });
    assert.deepEqual(fabric.commands.at(-1)?.args, [0, topOf(10), false]);
  });

  it('measures the distance to the end against the padded extent', async () => {
    const { instance, scroll } = await boot('VirtualSpaced');
    // Two viewports from the end is 800: at 3800 the end is 5040 - 4200 = 840 away.
    await scroll(3800);
    assert.deepEqual(instance.ends, []);
    await scroll(4000);
    assert.deepEqual(instance.ends, [5040 - 4400]);
  });

  it('pins a sticky row once the offset reaches its padded place', async () => {
    const { instance, scroll, row } = await boot('VirtualSpaced');
    instance.sticky.set([5]);
    await settle();
    await scroll(topOf(5) - 10);
    assert.notEqual(row(5)?.props['zIndex'], 1, 'not yet: the padding and gaps are above it');
    await scroll(topOf(5) + 30);
    assert.equal(row(5)?.props['zIndex'], 1);
    assert.equal(row(5)?.props['top'], topOf(5) + 30, 'held at the leading edge');
  });

  it('hands native a sticky row range that starts at its padded place', async () => {
    const { native, drives } = recorder();
    const { instance, scroll, row } = await boot('VirtualSpaced', { nativeAnimated: native });
    instance.sticky.set([0, 20]);
    await settle();
    await scroll(100);
    const pinned = row(0)!;
    // Row 0 starts at 20 and is pushed off when row 20, at 1020, reaches its bottom edge.
    assert.deepEqual(drives().get(pinned.reactTag)?.inputRange, [20, topOf(20) - 40]);
  });

  it('lays a horizontal list out along x, with the padding across it as its top and bottom', async () => {
    const { instance, row, canvas, fabric } = await boot('VirtualSpaced');
    instance.horizontal!.set(true);
    await settle();
    assert.equal(row(0)?.props['left'], 8);
    assert.equal(row(1)?.props['left'], 58);
    assert.equal(row(0)?.props['width'], 40);
    assert.equal(row(0)?.props['top'], 20);
    assert.equal(row(0)?.props['bottom'], 30);
    assert.equal(canvas().props['width'], 8 + 4000 + 990 + 12);
    instance.list().scrollToIndex({ index: 10, animated: false });
    assert.deepEqual(fabric.commands.at(-1)?.args, [8 + 500, 0, false]);
  });
});

describe('a windowed list of rows that size themselves, with padding and a gap', () => {
  // Rows are estimated at 50 until measured, so before any measurement row `i` starts at
  // 20 + 60i, and 100 rows make 20 + 100 * 50 + 99 * 10 + 30 = 6040.
  const estimatedTop = (index: number) => 20 + 60 * index;

  it('leads the rows with the padding, and spaces and insets them by margins', async () => {
    const { canvas, row } = await boot('VirtualSpacedMeasured');
    assert.equal(canvas().children[0]?.props['height'], 20, 'the spacer stands in for the padding');
    assert.equal(row(0)?.props['marginBottom'], 10);
    assert.equal(row(0)?.props['marginLeft'], 8);
    assert.equal(row(0)?.props['marginRight'], 12);
    assert.equal(canvas().props['height'], 6040);
  });

  it('sizes the content from what the rows measure, plus the gaps and padding', async () => {
    const { canvas, row } = await boot('VirtualSpacedMeasured');
    await fireEvent(row(0)!, 'layout', { layout: { x: 8, y: 20, width: 380, height: 80 } });
    assert.equal(canvas().props['height'], 6040 + 30);
  });

  it('stands the spacer in for the padding, rows and gaps above the window', async () => {
    const { canvas, scroll } = await boot('VirtualSpacedMeasured');
    await scroll(estimatedTop(11));
    // The window starts two rows of overscan above row 11.
    assert.equal(canvas().children[0]?.props['height'], estimatedTop(9));
  });

  it('keeps a pinned row in flow from pushing the window down by its gap', async () => {
    const { instance, canvas, scroll, row } = await boot('VirtualSpacedMeasured');
    instance.sticky.set([0]);
    await settle();
    await scroll(estimatedTop(40));
    // The pinned row and its gap sit between the spacer and row 38, which still starts at its
    // own place: the spacer is shorter by both.
    const lead = estimatedTop(38) - 50 - 10;
    assert.equal(canvas().children[0]?.props['height'], lead);
    assert.equal(row(0)?.props['zIndex'], 1);
    assert.deepEqual(row(0)?.props['transform'], [{ translateY: estimatedTop(40) - lead }]);
  });
});
