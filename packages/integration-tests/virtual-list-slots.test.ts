/**
 * What FlatList renders around its rows rather than as them: separators between items, and
 * headers that stick to the leading edge. Neither is native. RN's `ScrollView.js` pins a sticky
 * header by translating it against the scroll offset, and that is what is done here too.
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
import { recorder } from './native-animated.ts';
import { holdStickySettle, type StickySettleClock } from './sticky-settle-clock.ts';

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
  inverted: { set(value: boolean): void };
  horizontal: { set(value: boolean): void };
}

/** A scroll stays mid-scroll until a test calls `clock.rest()`, however slow the runner is. */
let clock: StickySettleClock;
beforeEach(() => {
  clock = holdStickySettle();
});
afterEach(() => clock.restore());

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/list-slots.ts');
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

  it('leaves the header in place before the list has scrolled', async () => {
    // Android sends no scroll event until the list moves, so nothing has said where it is yet.
    const { fabric, instance, unmount } = await boot<Separated>('Separated');
    instance.stickyHeader.set(true);
    instance.items.set(Array.from({ length: 200 }, (_, i) => 'r' + i));
    await fireEvent(header(fabric), 'layout', { layout: { height: 50 } });

    assert.equal(header(fabric).props['transform'] ?? null, null, 'not moved down by its height');
    unmount();
  });

  it('keeps the header at the offset when its height changes', async () => {
    const { fabric, instance, unmount } = await boot<Separated>('Separated');
    instance.stickyHeader.set(true);
    instance.items.set(Array.from({ length: 200 }, (_, i) => 'r' + i));
    await fireEvent(header(fabric), 'layout', { layout: { height: 50 } });
    await fireEvent.scroll(scrollView(fabric), { contentOffset: { y: 200 } });
    await fireEvent(header(fabric), 'layout', { layout: { height: 80 } });

    assert.deepEqual(header(fabric).props['transform'], [{ translateY: 200 }]);
    unmount();
  });

  describe('where native moves it', () => {
    async function pinned(sticky: readonly number[] = [4]) {
      const { native, drives, named } = recorder();
      const list = await boot<Separated>('Separated', 400, { nativeAnimated: native });
      list.instance.stickyHeader.set(true);
      list.instance.sticky.set(sticky);
      list.instance.items.set(Array.from({ length: 200 }, (_, i) => 'r' + i));
      await fireEvent(header(list.fabric), 'layout', { layout: { height: 50 } });
      await frame();
      const range = () =>
        drives().get(header(list.fabric).reactTag) as
          { inputRange: number[]; outputRange: number[] } | undefined;
      return { ...list, range, named, drives };
    }

    it('moves the header by the scroll until the first sticky row pushes it off', async () => {
      const { range, unmount } = await pinned();
      // Row 4 is 160 into the rows: the header's far edge meets it at an offset of 160.
      assert.deepEqual(range()?.inputRange, [0, 160]);
      assert.deepEqual(range()?.outputRange, [0, 160]);
      unmount();
    });

    it('moves it with the scroll all the way down when no row pushes it off', async () => {
      const { range, unmount } = await pinned([]);
      assert.equal(range()?.inputRange[0], 0);
      assert.equal(range()?.outputRange[1], range()?.inputRange[1]);
      assert.ok(range()!.inputRange[1]! > 200 * 40, 'past the end of the list');
      unmount();
    });

    it('holds it where it is under a first sticky row at the very top', async () => {
      const { range, unmount } = await pinned([0]);
      assert.deepEqual(range()?.outputRange, [0, 0]);
      unmount();
    });

    it('writes no translate mid-scroll, and where it settled once scrolling pauses', async () => {
      const { fabric, unmount } = await pinned();
      fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 100 } });
      await frame();
      assert.equal(header(fabric).props['transform'] ?? null, null, 'nothing from JavaScript');
      clock.rest();
      await frame();
      assert.deepEqual(header(fabric).props['transform'], [{ translateY: 100 }]);
      unmount();
    });

    it('tells native where the list is when the header is pinned while scrolled', async () => {
      const { native, drives, named } = recorder();
      const { fabric, instance, unmount } = await boot<Separated>('Separated', 400, {
        nativeAnimated: native,
      });
      instance.items.set(Array.from({ length: 200 }, (_, i) => 'r' + i));
      await fireEvent(header(fabric), 'layout', { layout: { height: 50 } });
      fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 300 } });
      await frame();
      const before = named('set').length;
      instance.stickyHeader.set(true);
      await frame();
      assert.ok(drives().has(header(fabric).reactTag));
      assert.deepEqual(
        named('set')
          .slice(before)
          .map(([, , value]) => value),
        [300],
        'drawn pinned now, not at the next scroll event',
      );
      unmount();
    });

    it('moves the header along x once the list turns horizontal', async () => {
      const { fabric, instance, named, unmount } = await pinned([]);
      instance.horizontal.set(true);
      await frame();
      const tag = header(fabric).reactTag;
      const props = named('toView')
        .filter(([, , view]) => view === tag)
        .at(-1)![1];
      const parent = (child: unknown) => named('connect').find(([, , to]) => to === child)![1];
      const config = named('create').find(([, node]) => node === parent(parent(props)))![2] as {
        transforms: { property: string }[];
      };
      assert.equal(config.transforms[0]!.property, 'translateX');
      unmount();
    });

    it('leaves a header that is not sticky to the layout', async () => {
      const { native, drives } = recorder();
      const { fabric, unmount } = await boot<Separated>('Separated', 400, {
        nativeAnimated: native,
      });
      await fireEvent(header(fabric), 'layout', { layout: { height: 50 } });
      await frame();
      assert.equal(drives().has(header(fabric).reactTag), false);
      unmount();
    });

    it('keeps the flip of an inverted list after the move', async () => {
      const { fabric, instance, named, unmount } = await pinned();
      instance.inverted.set(true);
      await frame();
      const tag = header(fabric).reactTag;
      const props = named('toView')
        .filter(([, , view]) => view === tag)
        .at(-1)![1];
      const parent = (child: unknown) => named('connect').find(([, , to]) => to === child)![1];
      const transform = parent(parent(props));
      const config = named('create').find(([, node]) => node === transform)![2] as {
        transforms: { type: string; property: string; value?: number }[];
      };
      assert.deepEqual(
        config.transforms.map(({ type, property, value }) => [type, property, value]),
        [
          ['animated', 'translateY', undefined],
          ['static', 'scaleY', -1],
        ],
      );
      unmount();
    });

    it('draws the header from where native is when the list flips at rest, and mid-scroll leaves it to native', async () => {
      const { fabric, instance, named, unmount } = await pinned([]);
      fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 100 } });
      clock.rest();
      await frame();
      let before = named('set').length;
      instance.inverted.set(true);
      await frame();
      assert.deepEqual(
        named('set')
          .slice(before)
          .map(([, , value]) => value),
        [100],
        'the new drive starts where the list is, not at the top',
      );
      fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 120 } });
      await frame();
      before = named('set').length;
      instance.inverted.set(false);
      await frame();
      assert.equal(named('set').length, before, 'mid-scroll the next event draws it');
      unmount();
    });

    it('tells native no offset along the old axis when the list turns horizontal at rest', async () => {
      const { fabric, instance, named, unmount } = await pinned([]);
      fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 100 } });
      clock.rest();
      await frame();
      const before = named('set').length;
      instance.horizontal.set(true);
      await frame();
      assert.deepEqual(
        named('set')
          .slice(before)
          .map(([, , value]) => value),
        [],
        'where native was along y says nothing of where it is along x',
      );
      unmount();
    });

    it('tells native no offset along the old axis when the list turns horizontal as the header s range changes', async () => {
      const { fabric, instance, named, unmount } = await pinned([]);
      fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 100 } });
      clock.rest();
      await frame();
      const before = named('set').length;
      instance.horizontal.set(true);
      instance.sticky.set([4]);
      await frame();
      assert.ok(
        !named('set')
          .slice(before)
          .some(([, , value]) => value === 100),
        'no y offset for x',
      );
      unmount();
    });

    it('draws a lone sticky row from where native is when the list flips at rest', async () => {
      const { native, named } = recorder();
      const { fabric, instance, unmount } = await boot<Separated>('Separated', 400, {
        nativeAnimated: native,
      });
      instance.sticky.set([4]);
      instance.items.set(Array.from({ length: 200 }, (_, i) => 'r' + i));
      await fireEvent(header(fabric), 'layout', { layout: { height: 50 } });
      fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 100 } });
      clock.rest();
      await frame();
      const before = named('set').length;
      instance.inverted.set(true);
      await frame();
      assert.deepEqual(
        named('set')
          .slice(before)
          .map(([, , value]) => value),
        [100],
        'the new drive starts where the list is, not at the top',
      );
      unmount();
    });

    it('lets native go of it when the list goes', async () => {
      const { fabric, drives, unmount } = await pinned([]);
      const tag = header(fabric).reactTag;
      assert.ok(drives().has(tag));
      unmount();
      assert.equal(drives().has(tag), false);
    });

    it('moves it nowhere once it is no longer sticky, from where native is', async () => {
      const { fabric, instance, range, named, unmount } = await pinned([]);
      fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 100 } });
      await frame();
      const before = named('set').length;
      instance.stickyHeader.set(false);
      await frame();
      assert.deepEqual(range()?.outputRange, [0, 0]);
      assert.deepEqual(
        named('set')
          .slice(before)
          .map(([, , value]) => value),
        [100],
        'native is told where the scroll view is, so it draws the header back now',
      );
      const told = named('set').length;
      instance.items.set(Array.from({ length: 300 }, (_, i) => 'r' + i));
      await frame();
      assert.equal(named('set').length, told, 'and only then, not on every render after');
      unmount();
    });

    it('draws a new limit at rest from where native is, and mid-scroll leaves it to native', async () => {
      const { fabric, instance, range, named, unmount } = await pinned([4]);
      fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 100 } });
      clock.rest();
      await frame();
      let before = named('set').length;
      instance.sticky.set([6]);
      await frame();
      assert.deepEqual(range()?.inputRange, [0, 240]);
      assert.deepEqual(
        named('set')
          .slice(before)
          .map(([, , value]) => value),
        [100],
        'at rest no scroll event comes to draw the new limit',
      );
      const told = named('set').length;
      instance.items.set(Array.from({ length: 300 }, (_, i) => 'r' + i));
      await frame();
      assert.equal(named('set').length, told, 'not told again while the limit holds');
      fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y: 120 } });
      await frame();
      before = named('set').length;
      instance.sticky.set([4]);
      await frame();
      assert.deepEqual(range()?.inputRange, [0, 160]);
      assert.equal(named('set').length, before, 'mid-scroll the next event draws it');
      unmount();
    });
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
    clock.rest();
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
