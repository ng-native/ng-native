/**
 * Rows that size themselves, as a feed's and a chat's do: a post's height depends on its text,
 * its images and the width it is laid out at, none of which JavaScript knows. The list lays the
 * window out in normal flow, so native places every row correctly in the same frame, and learns
 * each row's height from its layout to size what is not rendered.
 *
 * And what a list that changes under the user has to keep: a row's view and state stay with its
 * item across an insert, and with `maintainVisibleContentPosition` what is on screen stays put.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
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

const VIEWPORT = 800;
const ESTIMATE = 100;

interface Post {
  readonly id: number;
  readonly text: string;
}

interface ListHandle {
  window(): readonly { index: number; slot: number; key: unknown; item: Post }[];
  scrollToIndex(options: { index: number; animated?: boolean }): void;
}

interface Fixture {
  list(): ListHandle;
  items: { (): Post[]; set(value: Post[]): void };
  anchoring: {
    set(value: { minIndexForVisible?: number; autoscrollToTopThreshold?: number }): void;
  };
  sticky?: { set(value: readonly number[]): void };
  separated?: { set(value: boolean): void };
}

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

let mod: Record<string, unknown>;
let posts: (from: number, count: number) => Post[];

before(async () => {
  mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/virtual-measured.ts', import.meta.url)),
  );
  posts = mod['posts'] as typeof posts;
});

async function boot(name: string, options: Parameters<typeof render>[1] = {}) {
  const rendered = await render(mod[name] as Type<unknown>, options);
  const fabric = rendered.fabric;
  const instance = rendered.instance as Fixture;
  const scrollView = () => flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
  await fireEvent(scrollView(), 'layout', { layout: { width: 400, height: VIEWPORT } });

  const row = (id: number) =>
    flatten(fabric.committed).find((n) => n.props['nativeID'] === `post${id}`);
  const rendered_ = () =>
    flatten(fabric.committed)
      .map((n) => String(n.props['nativeID'] ?? ''))
      .filter((id) => /^post\d+$/.test(id))
      .map((id) => Number(id.slice(4)));
  /** Report a row's height as native would after laying it out. */
  const measure = async (id: number, height: number) => {
    const node = row(id);
    assert.ok(node, `post ${id} is rendered to be measured`);
    await fireEvent(node, 'layout', { layout: { x: 0, y: 0, width: 400, height } });
  };
  /** Measure every rendered row, including those a measurement brings into the window. */
  const measureAll = async (height: (id: number) => number) => {
    const done = new Set<number>();
    for (let pending = rendered_(); pending.length;) {
      for (const id of pending) {
        done.add(id);
        if (row(id)) await measure(id, height(id));
      }
      pending = rendered_().filter((id) => !done.has(id));
    }
  };
  const scroll = async (y: number) => fireEvent.scroll(scrollView(), { contentOffset: { y } });
  const canvas = () => scrollView().children[1]!;
  const scrolls = () => fabric.commands.filter((command) => command.name === 'scrollTo');

  return {
    fabric,
    instance,
    scrollView,
    row,
    rendered: rendered_,
    measure,
    measureAll,
    scroll,
    canvas,
    scrolls,
    unmount: rendered.unmount,
  };
}

describe('virtual list with measured rows', () => {
  it('lays the window out in flow, so no row waits on a measurement to be placed', async () => {
    const { rendered, row, canvas, unmount } = await boot('Measured');
    assert.ok(rendered().length > 0);
    for (const id of rendered()) {
      assert.notEqual(row(id)!.props['position'], 'absolute', `post ${id} is in flow`);
      assert.equal(row(id)!.props['height'], undefined, `post ${id} sizes itself`);
    }
    assert.equal(canvas().props['height'], 200 * ESTIMATE, 'unmeasured rows count as the estimate');
    unmount();
  });

  it('sizes the list from what it has measured', async () => {
    const { measure, rendered, canvas, unmount } = await boot('Measured');
    const first = rendered().slice(0, 3);
    for (const id of first) await measure(id, 250);
    assert.equal(canvas().props['height'], 3 * 250 + 197 * ESTIMATE);
    unmount();
  });

  it('keeps the rows it scrolled past as a spacer of their measured height', async () => {
    const { measureAll, scroll, canvas, rendered, unmount } = await boot('Measured');
    // Scroll down a row at a time, measuring each window, as a finger would reveal them.
    for (let y = 0; y <= 20 * 60; y += 60) {
      await measureAll(() => 60);
      await scroll(y);
    }
    await measureAll(() => 60);
    const first = Math.min(...rendered());
    const spacer = canvas().children[0]!;
    assert.equal(spacer.props['height'], first * 60, 'the spacer is what is above the window');
    assert.ok(rendered().includes(20), 'the row at the offset is rendered');
    unmount();
  });

  it('keeps a measurement with its item when rows are inserted above it', async () => {
    const { instance, measure, canvas, unmount } = await boot('Measured');
    await measure(0, 300);
    instance.items.set([...posts(1000, 2), ...instance.items()]);
    await settle();
    assert.equal(canvas().props['height'], 300 + 201 * ESTIMATE, 'post 0 is still 300 tall');
    unmount();
  });

  it('keeps each row s view and its state with its item across an insert', async () => {
    const { fabric, instance, row, unmount } = await boot('Measured');
    await fireEvent.press(
      flatten(fabric.committed).find((n) => n.props['nativeID'] === 'toggle3')!,
    );
    const view = row(3)!.reactTag;
    assert.match(textIn(row(3)!), /open/);

    instance.items.set([...posts(1000, 1), ...instance.items()]);
    await settle();

    assert.equal(row(3)!.reactTag, view, 'post 3 kept its native view');
    assert.match(textIn(row(3)!), /post 3 open/, 'and its row kept its own state');
    assert.match(
      textIn(row(2)!),
      /post 2 closed/,
      'which did not pass to the row now in its place',
    );
    unmount();
  });

  it('holds what is on screen still when rows are inserted above it', async () => {
    const { instance, scroll, scrolls, rendered, measureAll, unmount } = await boot('Measured');
    instance.anchoring.set({ minIndexForVisible: 0 });
    await settle();
    for (let y = 0; y <= 50 * ESTIMATE; y += 400) {
      await scroll(y);
      await measureAll(() => ESTIMATE);
    }
    await scroll(50 * ESTIMATE + 30);
    const before = scrolls().length;

    instance.items.set([...posts(1000, 3), ...instance.items()]);
    await settle();

    const correction = scrolls().slice(before);
    assert.equal(correction.length, 1, 'one correction');
    assert.deepEqual(correction[0]!.args, [0, 53 * ESTIMATE + 30, false]);
    assert.ok(rendered().includes(50), 'post 50 is still in the window');
    unmount();
  });

  it('holds what is on screen still when the header before it changes size', async () => {
    const { instance, scroll, scrolls, scrollView, unmount } = await boot('Measured');
    instance.anchoring.set({ minIndexForVisible: 0, autoscrollToTopThreshold: 20 });
    await settle();
    // The header wraps the listHeader content; it is the scroll view's first child.
    const header = () => scrollView().children[0]!;
    await fireEvent(header(), 'layout', { layout: { x: 0, y: 0, width: 400, height: 10 } });
    await scroll(10 + 3000);
    const before = scrolls().length;

    // A typing indicator appears in it, far from where the user is reading.
    await fireEvent(header(), 'layout', { layout: { x: 0, y: 0, width: 400, height: 40 } });
    assert.deepEqual(
      scrolls()
        .slice(before)
        .map((command) => command.args),
      [[0, 40 + 3000, false]],
    );
    unmount();
  });

  it('lets the header push the rows at the start, where the user is looking at it', async () => {
    const { instance, scroll, scrolls, scrollView, unmount } = await boot('Measured');
    instance.anchoring.set({ minIndexForVisible: 0, autoscrollToTopThreshold: 20 });
    await settle();
    const header = () => scrollView().children[0]!;
    await fireEvent(header(), 'layout', { layout: { x: 0, y: 0, width: 400, height: 10 } });
    await scroll(0);
    const before = scrolls().length;
    await fireEvent(header(), 'layout', { layout: { x: 0, y: 0, width: 400, height: 40 } });
    assert.equal(scrolls().length, before);
    unmount();
  });

  it('leaves the offset alone on an insert unless asked to hold position', async () => {
    const { instance, scroll, scrolls, unmount } = await boot('Measured');
    await scroll(50 * ESTIMATE);
    const before = scrolls().length;
    instance.items.set([...posts(1000, 3), ...instance.items()]);
    await settle();
    assert.equal(scrolls().length, before);
    unmount();
  });

  it('shows the new rows instead when within the autoscroll threshold of the start', async () => {
    const { instance, scroll, scrolls, rendered, unmount } = await boot('Measured');
    instance.anchoring.set({ minIndexForVisible: 0, autoscrollToTopThreshold: 20 });
    await settle();
    await scroll(10);
    const before = scrolls().length;
    instance.items.set([...posts(1000, 3), ...instance.items()]);
    await settle();
    assert.deepEqual(
      scrolls()
        .slice(before)
        .map((command) => command.args),
      [[0, 0, true]],
      'a feed at its top shows what arrived',
    );
    assert.ok(rendered().includes(1000));
    unmount();
  });

  it('corrects the offset when rows above the one on screen measure differently', async () => {
    const { instance, scroll, scrolls, measure, rendered, unmount } = await boot('Measured');
    // Straight to row 100, over rows never rendered: every one above it is an estimate.
    instance.list().scrollToIndex({ index: 100, animated: false });
    await scroll(100 * ESTIMATE);
    const before = scrolls().length;

    // The overscan above it lays out taller than estimated, which would push row 100 down.
    const above = rendered().filter((id) => id < 100);
    assert.ok(above.length > 0, 'there is overscan above');
    for (const id of above) await measure(id, ESTIMATE + 50);

    const last = scrolls().at(-1)!;
    assert.ok(scrolls().length > before, 'the offset is corrected');
    assert.deepEqual(last.args, [0, 100 * ESTIMATE + above.length * 50, false]);
    unmount();
  });

  it('does not correct for rows below the one on screen', async () => {
    const { scroll, scrolls, measureAll, unmount } = await boot('Measured');
    await measureAll(() => ESTIMATE);
    await scroll(0);
    const before = scrolls().length;
    await measureAll(() => ESTIMATE * 3);
    assert.equal(scrolls().length, before);
    unmount();
  });

  it('places a separator over the trailing edge of each measured row', async () => {
    const { instance, measureAll, fabric, unmount } = await boot('Measured');
    instance.separated!.set(true);
    await settle();
    await measureAll(() => 80);
    const gaps = flatten(fabric.committed).filter((n) =>
      n.children.some((child) => child.props['nativeID'] === 'separator'),
    );
    assert.ok(gaps.length > 2);
    assert.deepEqual(
      gaps.slice(0, 2).map((gap) => [gap.props['top'], gap.props['height']]),
      [
        [0, 80],
        [80, 80],
      ],
    );
    unmount();
  });

  it('pins a sticky row with a transform, leaving it in flow', async () => {
    const { instance, scroll, measureAll, row, unmount } = await boot('Measured');
    instance.sticky!.set([0]);
    await settle();
    await measureAll(() => ESTIMATE);
    await scroll(3 * ESTIMATE);
    await measureAll(() => ESTIMATE);
    const pinned = row(0)!;
    assert.notEqual(pinned.props['position'], 'absolute');
    assert.deepEqual(pinned.props['transform'], [{ translateY: 3 * ESTIMATE }]);
    assert.equal(pinned.props['zIndex'], 1);
    unmount();
  });
});

describe('virtual list sticky rows moved on the native side', () => {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));

  it('leaves a pinned row at its own place and has native move it with the scroll', async () => {
    const { native, drives } = recorder();
    const { instance, scroll, measureAll, row, canvas, unmount } = await boot('Measured', {
      nativeAnimated: native,
    });
    instance.sticky!.set([0, 20]);
    await settle();
    await measureAll(() => ESTIMATE);
    // The list commits the settled translate 64 ms after the last scroll event, and on a slow
    // runner measuring alone takes that long. Delayed timers are held until the assertion;
    // Angular's own zero-delay scheduling still runs.
    const setTimeout_ = globalThis.setTimeout;
    const held = mock.method(globalThis, 'setTimeout', ((callback: () => void, delay?: number) =>
      delay ? undefined : setTimeout_(callback, delay)) as typeof setTimeout);
    try {
      await scroll(10 * ESTIMATE);
      await measureAll(() => ESTIMATE);
    } finally {
      held.mock.restore();
    }

    const pinned = row(0)!;
    assert.equal(pinned.props['transform'], undefined, 'no translate from JavaScript mid-scroll');
    assert.equal(pinned.props['zIndex'], 1);
    assert.equal(canvas().children[0]!.props['height'], 0, 'the spacer stops where row 0 starts');
    const first = canvas().children[2]!;
    assert.equal(
      first.props['marginTop'],
      Number(String(first.props['nativeID']).slice(4)) * ESTIMATE - ESTIMATE,
      'and the rows between it and the window are made up before the window',
    );
    assert.deepEqual(
      drives().get(pinned.reactTag)?.inputRange,
      [0, 19 * ESTIMATE],
      'pinned from its own top until row 20 pushes it off',
    );
    unmount();
  });

  it('leaves the pinned row s props alone as the window moves, so native keeps its translate', async () => {
    // Fabric applying new props to a view native is moving puts its transform back to the one in
    // the props, and the row jumps for a frame.
    const { native } = recorder();
    const { instance, scroll, measureAll, row, unmount } = await boot('Measured', {
      nativeAnimated: native,
    });
    instance.sticky!.set([0]);
    await settle();
    await measureAll(() => ESTIMATE);
    await scroll(10 * ESTIMATE);
    await measureAll(() => ESTIMATE);
    const props = row(0)!.props;
    await scroll(14 * ESTIMATE);
    await measureAll(() => ESTIMATE);
    assert.equal(row(0)!.props, props);
    unmount();
  });

  it('writes the settled translate once the scroll pauses, so the props agree with native', async () => {
    const { native } = recorder();
    const { instance, scroll, measureAll, row, unmount } = await boot('Measured', {
      nativeAnimated: native,
    });
    instance.sticky!.set([0]);
    await settle();
    await measureAll(() => ESTIMATE);
    await scroll(10 * ESTIMATE);
    await pause();
    await settle();
    assert.deepEqual(row(0)!.props['transform'], [{ translateY: 10 * ESTIMATE }]);
    unmount();
  });

  it('lets a sticky row go once it is no longer rendered', async () => {
    const { native, drives } = recorder();
    const { instance, scroll, measureAll, row, unmount } = await boot('Measured', {
      nativeAnimated: native,
    });
    instance.sticky!.set([0, 20]);
    await settle();
    await measureAll(() => ESTIMATE);
    const tag = row(0)!.reactTag;
    await scroll(25 * ESTIMATE);
    await measureAll(() => ESTIMATE);
    assert.equal(row(0), undefined);
    assert.equal(drives().has(tag), false);
    assert.ok(drives().has(row(20)!.reactTag));
    unmount();
  });
});

describe('virtual list measuring cost', () => {
  it('measuring a row does not revisit every other row', async () => {
    const { instance, measure, rendered, unmount } = await boot('Measured');
    const counting = instance as unknown as { estimates: number };
    await measure(rendered()[0]!, 120);
    const before = counting.estimates;
    for (const id of rendered().slice(1, 5)) await measure(id, 120);
    assert.equal(counting.estimates - before, 0, 'no row is estimated again');
    unmount();
  });
});

describe('virtual list with fixed heights, keyed', () => {
  it('keeps a row in its slot across an insert above it', async () => {
    const { instance, scroll, unmount } = await boot('KeyedFixed');
    await scroll(100 * 40);
    const before = new Map(
      instance
        .list()
        .window()
        .map((row) => [row.key, row.slot]),
    );
    instance.items.set([...posts(5000, 2), ...instance.items()]);
    await settle();
    for (const row of instance.list().window()) {
      if (before.has(row.key)) assert.equal(row.slot, before.get(row.key), `post ${row.key}`);
    }
    unmount();
  });

  it('recycles a row only into a row of the same type', async () => {
    const { instance, scroll, unmount } = await boot('KeyedFixed');
    (instance as unknown as { typed: { set(value: boolean): void } }).typed.set(true);
    await settle();
    const typeOfSlot = new Map<number, string>();
    const check = () => {
      for (const row of instance.list().window()) {
        const type = row.item.id % 3 === 0 ? 'photo' : 'text';
        const seen = typeOfSlot.get(row.slot);
        assert.ok(
          seen === undefined || seen === type,
          `slot ${row.slot} held a ${seen}, now a ${type}`,
        );
        typeOfSlot.set(row.slot, type);
      }
    };
    check();
    for (let y = 0; y < 300 * 40; y += 97) {
      await scroll(y);
      check();
    }
    unmount();
  });

  it('holds position across an insert when asked', async () => {
    const { instance, scroll, scrolls, unmount } = await boot('KeyedFixed');
    instance.anchoring.set({ minIndexForVisible: 0 });
    await settle();
    await scroll(100 * 40 + 7);
    const before = scrolls().length;
    instance.items.set([...posts(5000, 5), ...instance.items()]);
    await settle();
    assert.deepEqual(
      scrolls()
        .slice(before)
        .map((command) => command.args),
      [[0, 105 * 40 + 7, false]],
    );
    unmount();
  });

  it('holds position across a removal above, and anchors past a removed row', async () => {
    const { instance, scroll, scrolls, unmount } = await boot('KeyedFixed');
    instance.anchoring.set({ minIndexForVisible: 0 });
    await settle();
    await scroll(100 * 40);
    const before = scrolls().length;
    instance.items.set(instance.items().filter((post) => post.id >= 10));
    await settle();
    assert.deepEqual(
      scrolls()
        .slice(before)
        .map((command) => command.args),
      [[0, 90 * 40, false]],
    );
    unmount();
  });
});

function textIn(node: FakeFabricNode): string {
  return flatten([node])
    .map((n) => n.props['text'])
    .filter((text) => typeof text === 'string')
    .join('');
}

export type { FakeFabric };

describe('virtual list with measured rows, when its items are replaced', () => {
  it('shows the new rows at the offset native is still at, not at the old row index', async () => {
    // Rows measured three times their estimate put row 20 at 6000 points. New items, still
    // unmeasured, put row 60 there instead; the viewport is still at 6000, so row 60 is what
    // should be on screen, not row 20 of the new items.
    const list = await boot('Measured');
    await list.measureAll(() => 300);
    for (let y = 600; y <= 6000; y += 600) {
      await list.scroll(y);
      await list.measureAll(() => 300);
    }
    list.instance.items.set(posts(1000, 200));
    await settle();
    const shown = list.rendered();
    assert.ok(shown.includes(1060), `rows at the offset: ${shown.join(' ')}`);
    assert.ok(!shown.includes(1020), `not the old index: ${shown.join(' ')}`);
  });
});
