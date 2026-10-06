/**
 * The windowed list. A thousand rows must not become a thousand native views.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
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

const ITEM_HEIGHT = 40;
const VIEWPORT = 400;

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

const labels = (fabric: FakeFabric): string[] =>
  flatten(fabric.committed)
    .filter((node) => typeof node.props['text'] === 'string')
    .map((node) => node.props['text'] as string);

describe('windowed list', () => {
  let Component: Type<unknown>;
  let fabric: FakeFabric;
  let host: FakeFabricNode;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/virtual.ts', import.meta.url)),
    );
    Component = mod['Virtual'] as Type<unknown>;
  });

  beforeEach(async () => {
    const rendered = await render(Component);
    fabric = rendered.fabric;
    host = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(host, 'layout', { layout: { height: VIEWPORT } });
  });

  it('commits the native scroll view, not a thousand rows', () => {
    assert.ok(host, 'virtual-list host is a real ScrollView');
    const rendered = labels(fabric);
    assert.ok(rendered.length < 30, `only a window is rendered, got ${rendered.length}`);
    assert.equal(rendered[0], 'row 0');
  });

  // Inside the content view the header slot comes first; the canvas is the child carrying the list's height.
  const canvasOf = (scroll: FakeFabricNode) => scroll.children[0]!.children[1]!;

  it('sizes the canvas to the full list so the scrollbar is honest', () => {
    const canvas = canvasOf(host);
    assert.equal(canvas.props['height'], 1000 * ITEM_HEIGHT);
  });

  it('keeps the canvas from being flattened away', () => {
    // A height is a layout-only prop, so Fabric would drop the view and drags over the gaps
    // between rows would land on the scroll view itself and not scroll.
    assert.equal(canvasOf(host).props['collapsable'], false);
  });

  it('positions each row absolutely at its own offset', () => {
    const slots = flatten(fabric.committed).filter((n) => n.props['position'] === 'absolute');
    assert.ok(slots.length > 0);
    assert.equal(slots[0]!.props['top'], 0);
    assert.equal(slots[1]!.props['top'], ITEM_HEIGHT);
    assert.equal(slots[0]!.props['height'], ITEM_HEIGHT);
  });

  it('moves the window on scroll without creating the whole list', async () => {
    fabric.reset();
    await fireEvent.scroll(host, { contentOffset: { y: 100 * ITEM_HEIGHT } });

    const rendered = labels(fabric);
    assert.ok(rendered.includes('row 100'), `window followed the offset: ${rendered[0]}`);
    assert.ok(!rendered.includes('row 0'), 'the top of the list is gone');
    assert.ok(
      fabric.calls.createNode < 60,
      `only the newly visible rows are created, got ${fabric.calls.createNode}`,
    );
  });

  it('reuses slot styles so a scroll does not re-clone stable rows', async () => {
    await fireEvent.scroll(host, { contentOffset: { y: 10 * ITEM_HEIGHT } });
    const before = flatten(fabric.committed).find((n) => n.props['text'] === 'row 12')!;

    await fireEvent.scroll(host, { contentOffset: { y: 10 * ITEM_HEIGHT + 4 } });
    const after = flatten(fabric.committed).find((n) => n.props['text'] === 'row 12')!;

    assert.equal(after, before, 'a row still in the window is reused by reference');
  });
});

describe('windowed list, when its items are replaced', () => {
  // A filter replaces the items wholesale. Native keeps the scroll offset it had, so the window
  // has to be worked out from that offset in the new items: kept as an index, or reset to the
  // start, it rendered rows at the top of the content while the viewport showed the middle, and
  // the screen went blank.
  let fabric: FakeFabric;
  let host: FakeFabricNode;
  let instance: { rows: { set(value: { id: number; label: string }[]): void } };
  const make = (count: number, prefix = 'row') =>
    Array.from({ length: count }, (_, i) => ({ id: i, label: `${prefix} ${i}` }));

  beforeEach(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/virtual.ts', import.meta.url)),
    );
    const rendered = await render(mod['Virtual'] as Type<unknown>);
    fabric = rendered.fabric;
    instance = rendered.instance as typeof instance;
    host = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(host, 'layout', { layout: { height: VIEWPORT } });
    await fireEvent.scroll(host, { contentOffset: { y: 400 * ITEM_HEIGHT } });
  });

  it('shows the new rows at the offset native is still at', async () => {
    instance.rows.set(make(1000, 'new'));
    await settle();
    const rendered = labels(fabric);
    assert.ok(rendered.includes('new 400'), `rows at the offset: ${rendered.slice(0, 3)}`);
    assert.ok(!rendered.includes('new 0'));
  });

  it('comes back to the offset after the items were empty for a moment', async () => {
    instance.rows.set([]);
    await settle();
    instance.rows.set(make(1000, 'back'));
    await settle();
    assert.ok(labels(fabric).includes('back 400'), labels(fabric).slice(0, 3).join());
  });

  it('scrolls back to the new end when the new items end before the offset', async () => {
    fabric.commands.length = 0;
    instance.rows.set(make(100, 'few'));
    await settle();
    const scroll = fabric.commands.find((c) => c.name === 'scrollTo');
    assert.deepEqual(scroll?.args, [0, 100 * ITEM_HEIGHT - VIEWPORT, false]);
    assert.ok(labels(fabric).includes('few 99'), labels(fabric).slice(0, 3).join());
  });
});

describe('windowed list, recycled by slot', () => {
  let fabric: FakeFabric;
  let host: FakeFabricNode;
  let list: { window(): readonly { index: number; slot: number }[] };
  let rows: {
    (): { id: number; label: string }[];
    set(value: { id: number; label: string }[]): void;
  };

  beforeEach(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/virtual.ts', import.meta.url)),
    );
    const { instance, ...rendered } = await render(mod['VirtualRecycled'] as Type<unknown>);
    fabric = rendered.fabric;
    host = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(host, 'layout', { layout: { height: VIEWPORT } });
    list = (instance as { list(): typeof list }).list();
    rows = (instance as { rows: typeof rows }).rows;
  });

  const scrollTo = async (y: number) => {
    await fireEvent.scroll(host, { contentOffset: { y } });
  };

  it('keeps a row in its slot for as long as it stays in the window', async () => {
    const before = new Map(list.window().map((row) => [row.index, row.slot]));
    await scrollTo(3 * ITEM_HEIGHT);
    for (const row of list.window()) {
      if (before.has(row.index)) assert.equal(row.slot, before.get(row.index), `row ${row.index}`);
    }
  });

  it('gives a row arriving the slot of one that has left, so no slot is new', async () => {
    // Mid-list, where the window is its full size: at the top the overscan above is clipped, so
    // the window legitimately grows on the first scroll.
    await scrollTo(100 * ITEM_HEIGHT);
    const slots = new Set(list.window().map((row) => row.slot));
    await scrollTo(103 * ITEM_HEIGHT);
    for (const row of list.window()) assert.ok(slots.has(row.slot), `slot ${row.slot} is reused`);
  });

  it('keeps a slot that left for a row arriving in a later pass, hidden meanwhile', async () => {
    await scrollTo(900 * ITEM_HEIGHT);
    // The list gets shorter below the window, but not above the offset: rows leave the window
    // with nothing arriving to take their slots. (Shorter than the offset, the list would scroll
    // back to its new end and bring rows in.)
    rows.set(rows().slice(0, 911));
    await settle();
    // Kept as views, to be used again: out of the flow, unseen and untouched, which a screen
    // reader passes over as it does anything with no opacity. Not
    // `display: none`, which is no view at all.
    const hidden = flatten(fabric.committed).filter((n) => n.props['opacity'] === 0);
    assert.ok(hidden.length > 0, 'the slots that left are kept, out of sight');
    for (const slot of hidden) {
      assert.equal(slot.props['position'], 'absolute');
      assert.equal(slot.props['pointerEvents'], 'none');
      assert.notEqual(slot.props['display'], 'none');
    }

    const created = fabric.calls.createNode;
    rows.set(Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `row ${i}` })));
    await settle();
    assert.equal(fabric.calls.createNode - created, 0, 'the rows that came back reused them');
    assert.ok(
      labels(fabric).some((label) => Number(label.slice(4)) > 910),
      'a row past the cut is back',
    );
  });

  it('shows the rows scrolled to, and creates no view for them', async () => {
    const created = fabric.calls.createNode;
    await scrollTo(100 * ITEM_HEIGHT);
    assert.ok(labels(fabric).includes('row 100'), 'the window moved');
    assert.ok(!labels(fabric).includes('row 0'), 'and the rows it left are gone');
    // A recycled row keeps its native views: what reaches Fabric is the new text, not new rows.
    assert.ok(
      fabric.calls.createNode - created < 20,
      `created ${fabric.calls.createNode - created} nodes`,
    );
  });
});

describe('native default props', () => {
  it('lets a caller override a default prop', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/virtual.ts', import.meta.url)),
    );
    const { fabric, unmount } = await render(mod['Virtual'] as Type<unknown>);

    const host = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    // The fixture binds `flex: 1`; the defaults must not clobber caller styles.
    assert.equal(host.props['flex'], 1);
    assert.equal(host.props['overflow'], 'scroll', 'default still applied');

    unmount();
  });
});

describe('windowed list, as a scroll view', () => {
  it('passes the scroll view s own props to the native scroll view', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/virtual.ts', import.meta.url)),
    );
    const { fabric } = await render(mod['VirtualCarousel'] as Type<unknown>);
    const props = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!.props;
    assert.equal(props['pagingEnabled'], true);
    assert.equal(props['showsHorizontalScrollIndicator'], false);
    assert.equal(props['decelerationRate'], 0.99, 'the named rate is resolved as UIKit takes it');
    assert.equal(props['snapToInterval'], 300);
    assert.equal(props['scrollEventThrottle'], 16);
    assert.equal(props['bounces'], false);
    assert.equal(props['scrollsToTop'], false);
    assert.equal(props['contentInsetAdjustmentBehavior'], 'never');
    assert.equal(props['keyboardDismissMode'], 'on-drag');
    assert.equal(props['alwaysBounceHorizontal'], true, 'bounces along its own axis, as RN does');
  });
});

describe('windowed list cost', () => {
  it('does not re-render for a scroll that leaves the window unchanged', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/virtual.ts', import.meta.url)),
    );
    const { fabric, unmount } = await render(mod['Virtual'] as Type<unknown>);
    const host = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(host, 'layout', { layout: { height: 400 } });
    fabric.reset();

    // A fling delivers a scroll event per frame. Sub-row movement must cost nothing.
    for (let y = 0; y < 39; y++) {
      fabric.emit(host, 'topScroll', { contentOffset: { y } });
    }
    await settle();

    assert.equal(fabric.calls.completeRoot, 0, '39 scroll events, no commits');

    await fireEvent.scroll(host, { contentOffset: { y: 40 * 5 } });
    assert.equal(fabric.calls.completeRoot, 1, 'crossing a row boundary commits once');

    unmount();
  });
});

/**
 * The options that change how the list is laid out or reported: a second axis, an inversion,
 * pinned rows, and viewability.
 */
describe('windowed list options', () => {
  let Component: Type<unknown>;
  let fabric: FakeFabric;
  let host: FakeFabricNode;
  let instance: {
    horizontal: { set(value: boolean): void };
    inverted: { set(value: boolean): void };
    sticky: { set(value: readonly number[]): void };
    viewable: () => readonly number[];
    changes: number;
    list(): { scrollToIndex(options: { index: number; animated?: boolean }): void };
  };

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/virtual.ts', import.meta.url)),
    );
    Component = mod['VirtualOptions'] as Type<unknown>;
  });

  const boot = async (
    size: { width?: number; height?: number },
    options: Parameters<typeof render>[1] = {},
  ) => {
    const rendered = await render(Component, options);
    fabric = rendered.fabric;
    instance = rendered.instance as typeof instance;
    host = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(host, 'layout', { layout: size });
  };

  const rows = () =>
    flatten(fabric.committed).filter((node) => node.props['position'] === 'absolute');
  /** Re-found on every read: a commit clones, so the node captured at boot is a previous one. */
  const scrollView = () => flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;

  it('lays out along x and scrolls that way when horizontal', async () => {
    await boot({ height: VIEWPORT });
    instance.horizontal.set(true);
    await settle();
    await fireEvent(host, 'layout', { layout: { width: VIEWPORT } });

    assert.equal(scrollView().props['horizontal'], true, 'the native scroll view scrolls sideways');
    const canvas = flatten(fabric.committed).find((n) => n.props['width'] === 1000 * ITEM_HEIGHT);
    assert.ok(canvas, 'the canvas is as wide as the list is long');
    assert.equal(rows()[0]?.props['left'], 0);
    assert.equal(rows()[0]?.props['width'], ITEM_HEIGHT);

    await fireEvent.scroll(host, { contentOffset: { x: 100 * ITEM_HEIGHT } });
    assert.ok(labels(fabric).includes('row 100'), 'the window followed x, not y');
  });

  it('scrolls a horizontal list to an item along x', async () => {
    await boot({ height: VIEWPORT });
    instance.horizontal.set(true);
    await settle();
    const list = (instance as unknown as { list(): { scrollToIndex(o: object): void } }).list();
    list.scrollToIndex({ index: 10, animated: false });
    assert.deepEqual(fabric.commands.at(-1), {
      viewName: 'ScrollView',
      name: 'scrollTo',
      args: [10 * ITEM_HEIGHT, 0, false],
    });
  });

  it('puts the header, the rows and the footer side by side when horizontal', async () => {
    await boot({ height: VIEWPORT });
    instance.horizontal.set(true);
    await settle();
    // ScrollView.js gives a horizontal scroll view `flexDirection: 'row'`. In a column the canvas,
    // which holds only absolutely positioned rows, has no height of its own, and every row with it.
    assert.equal(scrollView().props['flexDirection'], 'row');
  });

  // Android's ScrollView throws "ScrollView can host only one direct child" on a second one, and
  // Fabric flattens the header and footer views away, so their content counts as children too.
  for (const horizontal of [false, true]) {
    it(`gives the ${horizontal ? 'horizontal ' : ''}scroll view one child, holding the header, rows and footer`, async () => {
      await boot({ height: VIEWPORT });
      instance.horizontal.set(horizontal);
      await settle();
      assert.equal(scrollView().children.length, 1);
      const content = scrollView().children[0]!;
      assert.equal(content.props['collapsable'], false, 'or Fabric flattens it away again');
      assert.equal(content.props['flexDirection'], horizontal ? 'row' : undefined);
      const held = labels(fabric).filter((label) => label.startsWith('list '));
      assert.deepEqual(held, ['list header', 'list footer']);
      assert.deepEqual(
        flatten([content])
          .map((node) => node.props['text'])
          .filter((text) => typeof text === 'string' && text.startsWith('list ')),
        held,
      );
    });
  }

  it('flips the list and every row when inverted', async () => {
    await boot({ height: VIEWPORT });
    instance.inverted.set(true);
    await settle();

    assert.deepEqual(scrollView().props['transform'], [{ scaleY: -1 }]);
    assert.deepEqual(
      rows()[0]?.props['transform'],
      [{ scaleY: -1 }],
      'each row is flipped back, which is what keeps its content upright',
    );
    // The rows keep their order under the flip, so the first item is the one at the bottom: a
    // transcript is passed newest first, as FlatList takes it.
    assert.equal(rows()[0]?.props['top'], 0);
    assert.equal(
      labels(fabric).find((label) => label.startsWith('row ')),
      'row 0',
    );
    // FlatList flips its header and footer cells back too; without it they read upside down.
    const wrapperOf = (label: string) =>
      flatten(fabric.committed).find((n) =>
        n.children.some((child) => child.children.some((run) => run.props['text'] === label)),
      );
    assert.deepEqual(wrapperOf('list header')?.props['transform'], [{ scaleY: -1 }]);
    assert.deepEqual(wrapperOf('list footer')?.props['transform'], [{ scaleY: -1 }]);
  });

  it('renders its overscan on both sides of what is on screen, and no further', async () => {
    await boot({ height: VIEWPORT });
    await fireEvent.scroll(host, { contentOffset: { y: 100 * ITEM_HEIGHT } });
    const shown = labels(fabric);
    // Ten rows fit, from row 100; an overscan of two either side.
    for (const label of ['row 98', 'row 111']) assert.ok(shown.includes(label), label);
    for (const label of ['row 97', 'row 112']) assert.ok(!shown.includes(label), label);
  });

  it('flips a horizontal list along x when inverted', async () => {
    await boot({ width: VIEWPORT });
    instance.horizontal.set(true);
    instance.inverted.set(true);
    await settle();
    assert.deepEqual(rows()[0]?.props['transform'], [{ scaleX: -1 }]);
  });

  it('pins a sticky row the moment the offset reaches it', async () => {
    await boot({ height: VIEWPORT });
    instance.sticky.set([5]);
    await settle();
    await fireEvent.scroll(host, { contentOffset: { y: 5 * ITEM_HEIGHT } });
    assert.ok(rows().some((row) => row.props['zIndex'] === 1));
  });

  it('keeps a pinned row in its slot while the window moves on under it', async () => {
    await boot({ height: VIEWPORT });
    instance.sticky.set([0]);
    await settle();
    const list = (
      instance as unknown as { list(): { window(): { index: number; slot: number }[] } }
    ).list();
    await fireEvent.scroll(host, { contentOffset: { y: 50 * ITEM_HEIGHT } });
    const slot = list.window().find((row) => row.index === 0)!.slot;
    await fireEvent.scroll(host, { contentOffset: { y: 60 * ITEM_HEIGHT } });
    assert.equal(list.window().find((row) => row.index === 0)!.slot, slot);
  });

  it('scrolls to the last row for an index past the end', async () => {
    await boot({ height: VIEWPORT });
    const list = (instance as unknown as { list(): { scrollToIndex(o: object): void } }).list();
    list.scrollToIndex({ index: 5000, animated: false });
    assert.deepEqual(fabric.commands.at(-1)?.args, [0, 999 * ITEM_HEIGHT, false]);
  });

  it('pins a sticky row to the edge while the rows under it pass', async () => {
    await boot({ height: VIEWPORT });
    instance.sticky.set([0, 20]);
    await settle();

    await fireEvent.scroll(host, { contentOffset: { y: 5 * ITEM_HEIGHT } });

    const pinned = rows().find((row) => row.props['zIndex'] === 1)!;
    assert.equal(pinned.props['top'], 5 * ITEM_HEIGHT, 'row 0 rides the offset');
    assert.ok(
      labels(fabric).includes('row 0'),
      'and is rendered even though the window has left it behind',
    );

    // Past the second sticky row, it takes over.
    await fireEvent.scroll(host, { contentOffset: { y: 25 * ITEM_HEIGHT } });
    const next = rows().find((row) => row.props['zIndex'] === 1)!;
    assert.equal(next.props['top'], 25 * ITEM_HEIGHT);
    assert.ok(!labels(fabric).includes('row 0'), 'the one it replaced is no longer pinned');
  });

  it('leaves a sticky row in its own slot when native moves it', async () => {
    const { native, drives } = recorder();
    await boot({ height: VIEWPORT }, { nativeAnimated: native });
    instance.sticky.set([0, 20]);
    await settle();
    await fireEvent.scroll(host, { contentOffset: { y: 5 * ITEM_HEIGHT } });

    const pinned = rows().find((row) => row.props['zIndex'] === 1)!;
    assert.equal(pinned.props['top'], 0);
    assert.deepEqual(drives().get(pinned.reactTag)?.inputRange, [0, 19 * ITEM_HEIGHT]);
  });

  it('flips the rows without a style value Angular warns about in development', async () => {
    // A style binding is validated as the DOM's would be, and a transform list is not a value
    // the DOM takes: every row of an inverted list warned, which in a development build is a
    // LogBox warning per row as a chat scrolls.
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    try {
      await boot({ height: VIEWPORT });
      instance.inverted.set(true);
      instance.sticky.set([0]);
      await settle();
      await fireEvent.scroll(host, { contentOffset: { y: 5 * ITEM_HEIGHT } });
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(
      warnings.filter((line) => line.includes('NG0318')),
      [],
    );
  });

  it('scrolls to a row along the axis it lays rows out on', async () => {
    await boot({ height: VIEWPORT });
    instance.horizontal.set(true);
    await settle();
    await fireEvent(host, 'layout', { layout: { width: VIEWPORT } });
    const before = fabric.commands.length;
    instance.list().scrollToIndex({ index: 10, animated: false });
    assert.deepEqual(fabric.commands.slice(before), [
      { viewName: 'ScrollView', name: 'scrollTo', args: [10 * ITEM_HEIGHT, 0, false] },
    ]);
  });

  it('reports what is on screen, and only when the set changes', async () => {
    await boot({ height: VIEWPORT });
    assert.deepEqual(instance.viewable().slice(0, 3), [0, 1, 2], 'from the first layout');

    const before = instance.changes;
    await fireEvent.scroll(host, { contentOffset: { y: 4 } });
    assert.equal(instance.changes, before, 'four points moved nothing in or out');

    await fireEvent.scroll(host, { contentOffset: { y: 10 * ITEM_HEIGHT } });
    assert.equal(instance.viewable()[0], 10, 'the first fully-visible row');
    assert.ok(instance.changes > before);
  });
});

/**
 * A list of mixed heights, which is the only shape that can see the window being measured from
 * the wrong row. Every uniform fixture cancels the error out.
 */
describe('windowed list with mixed row heights', () => {
  let Component: Type<unknown>;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/virtual.ts', import.meta.url)),
    );
    Component = mod['VirtualMixed'] as Type<unknown>;
  });

  it('renders to the bottom of the viewport, not to the bottom of its overscan', async () => {
    const height = 400;
    const { fabric } = await render(Component);

    const host = () => flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(host(), 'layout', { layout: { height } });

    // The first thirty rows are 200 tall and the rest are 20, so scrolling to just past the tall
    // block puts two very tall rows behind the viewport and short ones ahead of it.
    const offset = 30 * 200;
    await fireEvent.scroll(host(), { contentOffset: { y: offset } });

    const rendered = flatten(fabric.committed)
      .map((n) => String(n.props['nativeID'] ?? ''))
      .filter((id) => id.startsWith('row'))
      .map((id) => Number(id.slice(3)))
      .sort((a, b) => a - b);

    assert.ok(rendered.length > 0, 'something is rendered');

    // Every row whose box overlaps the viewport has to be there. Anything missing is a gap the
    // user sees as the list ending early.
    const heightOf = (index: number) => (index < 30 ? 200 : 20);
    const topOf = (index: number) => (index <= 30 ? index * 200 : 30 * 200 + (index - 30) * 20);
    const needed: number[] = [];
    for (let i = 0; i < 200; i++) {
      const top = topOf(i);
      if (top + heightOf(i) > offset && top < offset + height) needed.push(i);
    }

    const missing = needed.filter((i) => !rendered.includes(i));
    assert.deepEqual(missing, [], `rows on screen but not rendered: ${missing.join(', ')}`);
  });
});
