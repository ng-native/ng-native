/**
 * What FlatList renders around its rows rather than as them: separators between items, and
 * headers that stick to the leading edge. Neither is native. RN's `ScrollView.js` pins a sticky
 * header by translating it against the scroll offset, and that is what is done here too.
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

/** A write outside change detection is committed on the next frame, which Node spells as 16ms. */
const frame = () => new Promise((resolve) => setTimeout(resolve, 20));
const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
const byID = (fabric: FakeFabric, id: string) =>
  flatten(fabric.committed).filter((node) => node.props['nativeID'] === id);
const scrollView = (fabric: FakeFabric) =>
  flatten(fabric.committed).find((node) => node.viewName === 'ScrollView')!;
const textOf = (node: FakeFabricNode) =>
  flatten([node])
    .map((n) => n.props['text'])
    .filter((t) => typeof t === 'string')
    .join('');

interface Separated {
  items: { set(value: string[]): void };
  stickyHeader: { set(value: boolean): void };
  sticky: { set(value: readonly number[]): void };
}

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(fileURLToPath(new URL('./fixtures/list-slots.ts', import.meta.url)));
});

async function boot<T>(name: string, height = 400, options: Parameters<typeof render>[1] = {}) {
  const rendered = await render(mod[name] as Type<unknown>, options);
  const { fabric, instance, unmount } = rendered;
  await fireEvent(scrollView(fabric), 'layout', { layout: { height } });
  return { fabric, instance: instance as T, unmount };
}

describe('virtual list separators', () => {
  it('renders one between each pair of items, and none after the last', async () => {
    const { fabric, unmount } = await boot<Separated>('Separated');
    const separators = byID(fabric, 'separator');
    assert.deepEqual(separators.map(textOf), ['a|b', 'b|c', 'c|d', 'd|e']);
    unmount();
  });

  it('puts each at the end of its leading row s slot, where touches pass through it', async () => {
    const { fabric, unmount } = await boot<Separated>('Separated');
    const canvas = scrollView(fabric).children[0]!.children[1]!;
    const second = canvas.children.find((node) => textOf(node) === 'b|c')!.props;
    assert.equal(second['position'], 'absolute');
    assert.equal(second['top'], 40, 'the slot of row 1');
    assert.equal(second['height'], 40);
    assert.equal(second['justifyContent'], 'flex-end', 'with the separator at its bottom');
    assert.equal(second['pointerEvents'], 'box-none', 'and the row under it still pressable');
    unmount();
  });

  it('follows the window, handing each its neighbours', async () => {
    const { fabric, instance, unmount } = await boot<Separated>('Separated');
    instance.items.set(Array.from({ length: 200 }, (_, i) => 'r' + i));
    await fireEvent.scroll(scrollView(fabric), { contentOffset: { y: 100 * 40 } });

    const rows = flatten(fabric.committed).filter((n) =>
      String(n.props['nativeID'] ?? '').startsWith('row'),
    );
    const separators = byID(fabric, 'separator').map(textOf);
    assert.ok(separators.includes('r100|r101'), separators.join(', '));
    assert.ok(!separators.includes('r0|r1'), 'the top of the list has gone');
    assert.equal(separators.length, rows.length, 'one per rendered row, none being the last');
    unmount();
  });

  it('updates a separator in place when its neighbours change', async () => {
    const { fabric, instance, unmount } = await boot<Separated>('Separated');
    instance.items.set(['a', 'x', 'c', 'd', 'e']);
    await settle();
    assert.deepEqual(byID(fabric, 'separator').map(textOf), ['a|x', 'x|c', 'c|d', 'd|e']);
    unmount();
  });
});

describe('virtual list sticky header', () => {
  const header = (fabric: FakeFabric) => scrollView(fabric).children[0]!.children[0]!;

  it('leaves the header in flow when it is not sticky', async () => {
    const { fabric, unmount } = await boot<Separated>('Separated');
    await fireEvent(header(fabric), 'layout', { layout: { height: 50 } });
    await fireEvent.scroll(scrollView(fabric), { contentOffset: { y: 200 } });
    assert.equal(header(fabric).props['transform'], undefined);
    unmount();
  });

  it('pins the header to the top while the rows scroll under it', async () => {
    const { fabric, instance, unmount } = await boot<Separated>('Separated');
    instance.stickyHeader.set(true);
    instance.items.set(Array.from({ length: 200 }, (_, i) => 'r' + i));
    await fireEvent(header(fabric), 'layout', { layout: { height: 50 } });
    await fireEvent.scroll(scrollView(fabric), { contentOffset: { y: 200 } });

    assert.deepEqual(header(fabric).props['transform'], [{ translateY: 200 }]);
    assert.equal(header(fabric).props['zIndex'], 1, 'drawn over the rows');

    await fireEvent.scroll(scrollView(fabric), { contentOffset: { y: -20 } });
    assert.equal(header(fabric).props['transform'] ?? null, null, 'not dragged down by a bounce');
    unmount();
  });

  it('is pushed off by the next sticky row, as RN s headers push each other', async () => {
    const { fabric, instance, unmount } = await boot<Separated>('Separated');
    instance.stickyHeader.set(true);
    instance.sticky.set([4]);
    instance.items.set(Array.from({ length: 200 }, (_, i) => 'r' + i));
    await fireEvent(header(fabric), 'layout', { layout: { height: 50 } });
    await fireEvent.scroll(scrollView(fabric), { contentOffset: { y: 300 } });

    // Row 4 starts 160 into the rows, which is 210 into the content: it reached the top at 210
    // and has pushed the header up with it.
    assert.deepEqual(header(fabric).props['transform'], [{ translateY: 160 }]);
    const pinned = byID(fabric, 'row4')[0]!;
    assert.equal(pinned.props['top'], 250, 'and row 4 rides the offset itself');
    unmount();
  });
});

describe('scroll view sticky headers', () => {
  it('translates each sticky child against the offset until the next one arrives', async () => {
    const { fabric, unmount } = await boot('StickyScroll');
    const first = () => byID(fabric, 'first')[0]!;
    const next = () => byID(fabric, 'more-1')[0]!;
    fabric.emit(first(), 'topLayout', { layout: { y: 0, height: 30 } });
    fabric.emit(next(), 'topLayout', { layout: { y: 100, height: 30 } });

    fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 50 } });
    await frame();
    assert.deepEqual(first().props['transform'], [{ translateY: 50 }]);
    assert.equal(first().props['zIndex'], 10, 'RN s sticky header zIndex');
    assert.equal(next().props['transform'], undefined, 'the next has not reached the top');

    fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 90 } });
    await frame();
    assert.deepEqual(first().props['transform'], [{ translateY: 70 }], 'pushed off by the next');

    fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 150 } });
    await frame();
    assert.deepEqual(next().props['transform'], [{ translateY: 50 }]);
    assert.equal(byID(fabric, 'body-1')[0]!.props['transform'], undefined, 'others stay put');
    unmount();
  });

  it('has native move each sticky child, and writes where it settled once scrolling pauses', async () => {
    const { native, drives } = recorder();
    const { fabric, unmount } = await boot('StickyScroll', 400, { nativeAnimated: native });
    const first = () => byID(fabric, 'first')[0]!;
    const next = () => byID(fabric, 'more-1')[0]!;
    fabric.emit(first(), 'topLayout', { layout: { y: 0, height: 30 } });
    fabric.emit(next(), 'topLayout', { layout: { y: 100, height: 30 } });
    await frame();
    assert.deepEqual(drives().get(first().reactTag)?.inputRange, [0, 70]);
    assert.equal(drives().get(next().reactTag)?.inputRange[0], 100);

    fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 50 } });
    await frame();
    assert.equal(first().props['transform'], undefined, 'nothing from JavaScript mid-scroll');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await frame();
    assert.deepEqual(first().props['transform'], [{ translateY: 50 }]);
    unmount();
  });

  it('asks for every scroll event while anything is sticky, as RN does', async () => {
    const { fabric, unmount } = await boot('StickyScroll');
    assert.equal(scrollView(fabric).props['scrollEventThrottle'], 1);
    unmount();
  });
});
