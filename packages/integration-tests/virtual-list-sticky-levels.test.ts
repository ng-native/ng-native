/**
 * `virtual-list[virtualListStickyLevel]`: sticky rows at more than one level, a year over its
 * month over its day, each pinned under the rows of the groups it is in.
 *
 * The geometry throughout: a list 400 along its axis, of three years of three months of three
 * days of five entries. A year's row is 50, a month's 40, a day's 30 and an entry 40, so the
 * heights a row pins under are told apart. Year `y` is row `58y`, its month `m` row `58y + 1 +
 * 19m` and that month's day `d` row `58y + 2 + 19m + 6d`. `top` below is where a row starts.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import {
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { recorder } from './native-animated.ts';

const WIDTH = 300;
const VIEWPORT = 400;
const YEAR = 50;
const MONTH = 40;
const DAY = 30;

interface Entry {
  readonly id: number;
  readonly label: string;
  readonly level: number | null;
}

type LevelOf = (entry: Entry, index: number) => number | null | undefined;

interface Instance {
  list(): {
    scrollToIndex(options: { index: number; animated?: boolean }): void;
    window(): { index: number; slot: number; parked?: boolean }[];
  };
  entries: WritableSignal<readonly Entry[]>;
  rowGap: WritableSignal<number>;
  horizontal: WritableSignal<boolean>;
  inverted: WritableSignal<boolean>;
  sticky: WritableSignal<readonly number[]>;
  stickyHeader: WritableSignal<boolean>;
  columns: WritableSignal<number>;
  levelOf: WritableSignal<LevelOf | null | undefined>;
  maxLevels: WritableSignal<number | undefined>;
}

let mod: Record<string, unknown>;
let entries: () => Entry[];
before(async () => {
  mod = await compileFixture('fixtures/virtual-sticky-levels.ts');
  entries = mod['entries'] as () => Entry[];
});

describe('a windowed list with sticky rows at several levels', () => {
  it('pins a month under its year, and a day under both', async () => {
    const { at, scroll } = await boot();
    await scroll(200);
    assert.equal(at(0), 200, 'the year is at the leading edge');
    assert.equal(at(1), 200 + YEAR, 'the month under it');
    assert.equal(at(2), 200 + YEAR + MONTH, 'and the day under both');
  });

  it('pins the last row reached when a negative rowGap overlaps the rows', async () => {
    // Two years and a month, 20 apart less than their sizes: the month is at 60 and holds from 10,
    // under the second year, which holds from 30 only.
    const levels = [0, 0, 1, ...Array.from({ length: 20 }, () => null)];
    const { at, scroll } = await boot((page) => {
      page.rowGap.set(-20);
      page.entries.set(levels.map((level, id) => ({ id, label: `row ${id}`, level })));
    });
    await scroll(20);
    assert.equal(at(2), 20 + YEAR, 'the month is pinned under the year it is in');
  });

  it('draws a pinned row over the rows pinned under it, and those over the rest', async () => {
    const { row, scroll } = await boot();
    await scroll(200);
    const z = (index: number) => (row(index)?.props['zIndex'] as number | undefined) ?? 0;
    assert.ok(z(0) > z(1), `the year (${z(0)}) is over the month (${z(1)})`);
    assert.ok(z(1) > z(2), `the month (${z(1)}) is over the day (${z(2)})`);
    assert.ok(z(2) > z(5), `the day (${z(2)}) is over an entry (${z(5)})`);
  });

  it('renders each pinned row the window has left behind', async () => {
    const { shown, scroll } = await boot();
    // The third day of the first month, row 14, is pinned, and the window starts at row 15.
    await scroll(650);
    assert.deepEqual(
      shown().filter((index) => index < 15),
      [0, 1, 14],
    );
  });

  it('keeps each pinned row in its slot, once in the window, while the window moves on', async () => {
    const { instance, scroll } = await boot();
    const list = instance.list();
    const held = () =>
      [0, 1, 14].map((index) => list.window().filter((row) => row.index === index));
    await scroll(650);
    const slots = held().map((rows) => rows[0]!.slot);
    await scroll(700);
    assert.deepEqual(
      held().map((rows) => rows.map((row) => row.slot)),
      slots.map((slot) => [slot]),
    );
  });

  it('pushes a day off with the next day, sliding it under the month, which stays', async () => {
    const { at, row, scroll } = await boot();
    // The second day, row 8, is 30 under where the first is pinned.
    await scroll(top(8) - YEAR - MONTH - 15);
    assert.equal(at(2), top(8) - DAY, 'the first day ends where the second starts');
    assert.equal(at(1), top(8) - 15 - MONTH, 'the month is still under the year');
    assert.equal(at(0), top(8) - 15 - MONTH - YEAR);

    await scroll(top(8) - YEAR - MONTH);
    assert.equal(at(8), top(8), 'the second day is where the first was pinned');
    assert.equal(row(8)?.props['zIndex'], 98);
    assert.equal(row(2)?.props['zIndex'] ?? null, null, 'and the first is pinned no longer');
  });

  it('pushes a month and its day off with the next month, while the year stays', async () => {
    const { at, row, scroll } = await boot();
    // The second month is row 20, and the last day of the first row 14.
    await scroll(top(20) - YEAR - 20);
    assert.equal(at(0), top(20) - YEAR - 20, 'the year follows the scroll');
    assert.equal(at(1), top(20) - MONTH, 'the month ends where the next starts');
    assert.equal(at(14), top(20) - DAY, 'and so does its day, under it');

    await scroll(top(20) - YEAR);
    assert.equal(at(0), top(20) - YEAR);
    assert.equal(at(20), top(20), 'the second month is under the year');
    assert.equal(at(21), top(21), 'with its first day');
    assert.equal(row(1)?.props['zIndex'] ?? null, null, 'the first month is pinned no longer');
  });

  it('pushes a year, its month and its day off with the next year', async () => {
    const { at, scroll } = await boot();
    // The second year is row 58; the last month of the first is row 39 and its last day row 52.
    await scroll(top(58) - 40);
    assert.equal(at(0), top(58) - YEAR, 'the year ends where the next starts');
    assert.equal(at(39), top(58) - MONTH);
    assert.equal(at(52), top(58) - DAY);

    await scroll(top(58));
    assert.equal(at(58), top(58));
    assert.equal(at(59), top(58) + YEAR);
    assert.equal(at(60), top(58) + YEAR + MONTH);
  });

  it('pins the whole chain of a row a jump lands under', async () => {
    const { instance, at, scroll } = await boot();
    // Row 100 is an entry of the first day (98) of the third month (97) of the second year (58).
    instance.list().scrollToIndex({ index: 100, animated: false });
    await scroll(top(100));
    assert.equal(at(58), top(100));
    assert.equal(at(97), top(100) + YEAR);
    assert.equal(at(98), top(100) + YEAR + MONTH);
  });

  it('pins as many levels as virtualListMaxStickyLevels says, and follows it changing', async () => {
    const { instance, at, row, scroll } = await boot((page) => page.maxLevels.set(2));
    await scroll(60);
    assert.equal(at(1), 60 + YEAR, 'the month is pinned');
    assert.equal(at(2), top(2), 'the day scrolls with the entries');
    assert.equal(row(2)?.props['zIndex'] ?? null, null);

    instance.maxLevels.set(1);
    await settle();
    assert.equal(at(0), 60);
    assert.equal(at(1), top(1), 'the month scrolls with the entries too');

    instance.maxLevels.set(undefined);
    await settle();
    assert.equal(at(1), 60 + YEAR);
    assert.equal(at(2), 60 + YEAR + MONTH, 'every level is pinned with no limit');
  });

  it('follows a new level function, and pins nothing once it is taken away', async () => {
    const { instance, at, row, scroll, shown } = await boot();
    await scroll(650);
    instance.levelOf.set((entry) => (entry.level === 1 ? 0 : null));
    await settle();
    assert.equal(at(1), 650, 'the month is the outermost now, at the leading edge');
    assert.ok(!shown().includes(0), 'the year went with the rows around it');
    assert.ok(!shown().includes(14), 'and so did the day');

    instance.levelOf.set(null);
    await settle();
    assert.ok(!shown().includes(1), 'no row is kept above the window');
    assert.ok(
      shown().every((index) => row(index)?.props['zIndex'] === undefined),
      'and none is pinned',
    );
  });

  for (const [name, off, on] of [
    [
      'virtualListMaxStickyLevels lets levels pin',
      (page: Instance) => page.maxLevels.set(0),
      (page: Instance) => page.maxLevels.set(undefined),
    ],
    [
      'a level function is given',
      (page: Instance) => page.levelOf.set(null),
      (page: Instance) => page.levelOf.set((entry) => entry.level),
    ],
    [
      'the items get their first sticky rows',
      (page: Instance) => page.entries.set(entries().map((entry) => ({ ...entry, level: null }))),
      (page: Instance) => page.entries.set(entries()),
    ],
  ] as const) {
    it(`pins the rows where a scrolled list is, with no scroll, once ${name}`, async () => {
      const { instance, at, scroll } = await boot(off);
      await scroll(650);
      on(instance);
      await settle();
      assert.deepEqual([0, 1, 14].map(at), [650, 650 + YEAR, 650 + YEAR + MONTH]);
    });
  }

  it('pins a row of stickyIndices where a scrolled list is, with no scroll, once it is given', async () => {
    const { instance, at, scroll } = await boot((page) => page.levelOf.set(null));
    await scroll(650);
    instance.sticky.set([0]);
    await settle();
    assert.equal(at(0), 650);
  });

  it('places the levels again when the items change', async () => {
    const { instance, at, scroll } = await boot();
    await scroll(200);
    // Without the first year, its months are the outermost rows of what is left of it.
    instance.entries.set(entries().slice(1));
    await settle();
    assert.equal(at(0), 200, 'the month is at the leading edge');
    assert.equal(at(1), 200 + MONTH, 'and its day under it');
  });

  it('counts the rows of stickyIndices as level 0, beside the levels', async () => {
    // Row 3 is the first entry: as a level 0 row it pushes the first year off and pins alone.
    const { at, row, scroll } = await boot((page) => page.sticky.set([3]));
    await scroll(top(3) - 20);
    assert.equal(at(0), top(3) - YEAR, 'the year is pushed off by it');
    await scroll(top(3) + 10);
    assert.equal(at(3), top(3) + 10);
    assert.equal(row(3)?.props['zIndex'], 100, 'drawn as far forward as a year');
    // The second day, row 8, is now under row 3 alone, which is 40 high.
    await scroll(top(8) - 40);
    assert.equal(at(3), top(8) - 40);
    assert.equal(at(8), top(8));
  });

  it('pushes a pinned header off with the first sticky row, and pins the levels after it', async () => {
    // Three plain rows first, so the first year is 120 down the rows.
    const plain = [0, 1, 2].map((id) => ({ id: -1 - id, label: `plain ${id}`, level: null }));
    const { at, scroll, header } = await boot((page) => {
      page.entries.set([...plain, ...entries()]);
      page.stickyHeader.set(true);
    });
    await fireEvent(header(), 'layout', { layout: { x: 0, y: 0, width: WIDTH, height: 60 } });
    await scroll(100);
    assert.deepEqual(header().props['transform'], [{ translateY: 100 }]);
    // 240 into the rows: the header stopped where the first year starts, and the year is pinned.
    await scroll(60 + 240);
    assert.deepEqual(header().props['transform'], [{ translateY: 120 }]);
    assert.equal(at(3), 240);
    assert.equal(at(4), 240 + YEAR);
  });

  it('gives a sticky row of any level a line to itself in columns', async () => {
    const { row, at } = await boot((page) => page.columns.set(3));
    for (const index of [0, 1, 2, 8]) {
      assert.deepEqual(across(row(index)!), { x: 0, width: WIDTH }, `row ${index} is a whole line`);
    }
    assert.equal(at(1), YEAR);
    assert.equal(at(2), YEAR + MONTH);
    // The first day's five entries are a line of three and a line of two.
    assert.deepEqual([3, 4, 5, 6, 7].map(at), [120, 120, 120, 160, 160]);
    assert.deepEqual(across(row(4)!), { x: 100, width: 100 });
    assert.equal(at(8), 200, 'and the second day starts the line after them');
  });

  it('pins the levels across the columns', async () => {
    const { at, scroll } = await boot((page) => page.columns.set(3));
    // The second day is 200 down, so the first is pushed off from 80.
    await scroll(60);
    assert.deepEqual([0, 1, 2].map(at), [60, 60 + YEAR, 60 + YEAR + MONTH]);
    await scroll(100);
    assert.deepEqual([0, 1, 2].map(at), [100, 100 + YEAR, 200 - DAY]);
  });

  it('pins the levels along x on a horizontal list', async () => {
    const { row, scrollView } = await boot((page) => page.horizontal.set(true));
    await fireEvent.scroll(scrollView(), { contentOffset: { x: 200 } });
    assert.deepEqual(
      [0, 1, 2].map((index) => row(index)?.props['left']),
      [200, 200 + YEAR, 200 + YEAR + MONTH],
    );
  });

  it('pins the levels on an inverted list, each row still flipped back', async () => {
    const { row, at, scroll } = await boot((page) => page.inverted.set(true));
    await scroll(200);
    assert.deepEqual([0, 1, 2].map(at), [200, 200 + YEAR, 200 + YEAR + MONTH]);
    for (const index of [0, 1, 2]) {
      assert.deepEqual(row(index)?.props['transform'], [{ scaleY: -1 }]);
    }
  });

  it("hands a deep sticky row's slot on only to another sticky row", async () => {
    const { instance, scroll } = await boot();
    const list = instance.list();
    const sticky = new Set(
      entries().flatMap((entry, index) => (entry.level === null ? [] : index)),
    );
    await scroll(100);
    const slot = list.window().find((row) => row.index === 2)!.slot;
    for (const y of [1000, 2000, 3000, 4000, 5000, 6000]) {
      await scroll(y);
      const taken = list.window().find((row) => row.slot === slot && !row.parked);
      assert.ok(!taken || sticky.has(taken.index), `row ${taken?.index} took the day's slot`);
    }
  });
});

describe('sticky rows at several levels, moved on the native side', () => {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));

  it('leaves each row at its own place, moved from where it meets the rows it pins under', async () => {
    const { native, drives } = recorder();
    const { row, at, scroll } = await boot(undefined, { nativeAnimated: native });
    await scroll(650);
    const range = (index: number) => drives().get(row(index)!.reactTag)?.inputRange;
    assert.deepEqual([0, 1, 14].map(at), [0, top(1), top(14)], 'no row is moved from JavaScript');
    assert.deepEqual(range(0), [0, top(58) - YEAR], 'the year, until the next year');
    assert.deepEqual(
      range(1),
      [top(1) - YEAR, top(20) - MONTH - YEAR],
      'the month, from under the year until the next month reaches it there',
    );
    assert.deepEqual(
      range(14),
      [top(14) - YEAR - MONTH, top(20) - DAY - YEAR - MONTH],
      'the day, from under both until the next month reaches it there',
    );
    // In the window, and not pinned yet: the second month and its first day.
    assert.deepEqual(range(20), [top(20) - YEAR, top(39) - MONTH - YEAR]);
    assert.deepEqual(range(21), [top(21) - YEAR - MONTH, top(27) - DAY - YEAR - MONTH]);
  });

  it('renders nothing again for a scroll that moves no row in or out of the window', async () => {
    const { native } = recorder();
    const { instance, scroll } = await boot(undefined, { nativeAnimated: native });
    await scroll(650);
    const window = instance.list().window();
    await scroll(655);
    assert.equal(instance.list().window(), window);
  });

  it('commits nothing on the rows native is moving when a deeper level arrives far below', async () => {
    // New props on a view native is moving put its transform back for a frame, so how the
    // pinned rows are ordered front to back cannot depend on what the rest of the list holds.
    const { native } = recorder();
    const { instance, row, scroll } = await boot(undefined, { nativeAnimated: native });
    await scroll(650);
    const pinned = () => [0, 1, 14].map((index) => row(index)!);
    const before = pinned();
    const order = before.map((node) => node.props['zIndex']);
    instance.entries.set([...instance.entries(), { id: 9001, label: 'hour', level: 3 }]);
    await settle();
    assert.deepEqual(
      pinned().map((node) => node.props['zIndex']),
      order,
    );
    assert.deepEqual(
      pinned().map((node, at) => node === before[at]),
      [true, true, true],
      'no pinned row is committed again',
    );
  });

  it('writes the translate of the rows where a scrolled list is once levels are let pin', async () => {
    const { native } = recorder();
    const { instance, row, scroll } = await boot((page) => page.maxLevels.set(0), {
      nativeAnimated: native,
    });
    await scroll(650);
    instance.maxLevels.set(undefined);
    await settle();
    assert.deepEqual(row(0)?.props['transform'], [{ translateY: 650 }]);
    assert.deepEqual(row(1)?.props['transform'], [{ translateY: 650 - (top(1) - YEAR) }]);
  });

  it('draws a row native moves over the rows pinned under it', async () => {
    const { native } = recorder();
    const { row, scroll } = await boot(undefined, { nativeAnimated: native });
    await scroll(650);
    assert.deepEqual(
      [0, 1, 14, 17].map((index) => row(index)?.props['zIndex'] ?? 0),
      [100, 99, 98, 0],
    );
  });

  it('counts the header in where native moves each level from', async () => {
    const { native, drives } = recorder();
    const { row, scroll, header } = await boot(undefined, { nativeAnimated: native });
    await fireEvent(header(), 'layout', { layout: { x: 0, y: 0, width: WIDTH, height: 60 } });
    await scroll(60 + 650);
    assert.deepEqual(drives().get(row(14)!.reactTag)?.inputRange, [
      60 + top(14) - YEAR - MONTH,
      60 + top(20) - DAY - YEAR - MONTH,
    ]);
  });

  it('has native hold a row still that the next pushes off where it would pin', async () => {
    // A day with nothing in it, and the next month straight after: the day has nowhere to pin.
    const rows = [
      { id: 0, label: 'year', level: 0 },
      { id: 1, label: 'month', level: 1 },
      { id: 2, label: 'day', level: 2 },
      { id: 3, label: 'next month', level: 1 },
      ...Array.from({ length: 40 }, (_, i) => ({ id: 4 + i, label: `entry ${i}`, level: null })),
    ];
    const { native, drives } = recorder();
    const { row, scroll } = await boot((page) => page.entries.set(rows), {
      nativeAnimated: native,
    });
    await scroll(10);
    assert.deepEqual(
      (drives().get(row(2)!.reactTag) as { outputRange?: number[] }).outputRange,
      [0, 0],
      'the day is moved nowhere',
    );
    assert.deepEqual(drives().get(row(1)!.reactTag)?.inputRange, [0, 120 - MONTH - YEAR]);
    assert.ok(drives().get(row(3)!.reactTag), 'the month after it is moved');
  });

  it("writes each level's settled translate once the scroll pauses", async () => {
    const { native } = recorder();
    const { row, scroll } = await boot(undefined, { nativeAnimated: native });
    await scroll(650);
    await pause();
    await settle();
    const moved = (index: number) => row(index)?.props['transform'];
    assert.deepEqual(moved(0), [{ translateY: 650 }]);
    assert.deepEqual(moved(1), [{ translateY: 650 - (top(1) - YEAR) }]);
    assert.deepEqual(moved(14), [{ translateY: 650 - (top(14) - YEAR - MONTH) }]);
    assert.equal(moved(20), undefined, 'a row not pinned yet has none');
  });

  it('counts the header in where a settled row is, at the size it is now', async () => {
    const { native } = recorder();
    const { row, scroll, header } = await boot(undefined, { nativeAnimated: native });
    await fireEvent(header(), 'layout', { layout: { x: 0, y: 0, width: WIDTH, height: 60 } });
    await scroll(60 + 650);
    await pause();
    await settle();
    assert.deepEqual(row(0)?.props['transform'], [{ translateY: 650 }]);
    // The header grows by 20 and the scroll view stays put: the leading edge is 20 less far in.
    await fireEvent(header(), 'layout', { layout: { x: 0, y: 0, width: WIDTH, height: 80 } });
    await settle();
    assert.deepEqual(row(0)?.props['transform'], [{ translateY: 630 }]);
  });

  it('holds a settled row where the next pushed it to', async () => {
    const { native } = recorder();
    const { row, scroll } = await boot(undefined, { nativeAnimated: native });
    // 20 short of where the second month pins: the first month and its day are being pushed off.
    await scroll(top(20) - YEAR - 20);
    await pause();
    await settle();
    assert.deepEqual(row(1)?.props['transform'], [{ translateY: top(20) - MONTH - top(1) }]);
    assert.deepEqual(row(14)?.props['transform'], [{ translateY: top(20) - DAY - top(14) }]);
  });

  it('has native move the whole chain a jump lands under, from where it landed', async () => {
    const { native, drives, named } = recorder();
    const { instance, row, shown, scroll } = await boot(undefined, { nativeAnimated: native });
    // Row 100 is an entry of the first day (98) of the third month (97) of the second year (58).
    instance.list().scrollToIndex({ index: 100, animated: false });
    await settle();
    await scroll(top(100));
    await settle();
    for (const index of [58, 97, 98]) {
      assert.ok(shown().includes(index), `row ${index} is rendered`);
      assert.ok(drives().get(row(index)!.reactTag), `and native moves row ${index}`);
    }
    assert.deepEqual(drives().get(row(98)!.reactTag)?.inputRange, [
      top(98) - YEAR - MONTH,
      top(104) - DAY - YEAR - MONTH,
    ]);
    // Native is told where the jump went, since its offset has not changed since the rows that
    // are pinned there were handed to it.
    const offset = named('create').find(
      ([, , config]) => (config as { offset?: number }).offset !== undefined,
    )![1];
    assert.deepEqual(
      named('set')
        .filter(([, tag]) => tag === offset)
        .at(-1),
      ['set', offset, top(100)],
    );
  });
});

describe('sticky levels on rows that size themselves', () => {
  it('pins level 0 alone, and says why in development', async () => {
    const warnings = await warned(async () => {
      const { row, scroll } = await boot(
        (page) => page.levelOf.set((entry) => entry.level),
        {},
        'VirtualStickyLevelsMeasured',
      );
      await scroll(100);
      assert.equal(row(0)?.props['zIndex'], 1, 'the year is pinned');
      assert.deepEqual(row(0)?.props['transform'], [{ translateY: 100 }]);
      assert.equal(row(1)?.props['zIndex'] ?? null, null, 'the month is in flow');
      assert.equal(row(1)?.props['transform'] ?? null, null);
    });
    assert.equal(warnings.filter((line) => line.includes('virtualListStickyLevel')).length, 1);
  });

  it('says nothing where no row is deeper than level 0', async () => {
    const warnings = await warned(async () => {
      const { row, scroll } = await boot(undefined, {}, 'VirtualStickyLevelsMeasured');
      await scroll(100);
      assert.equal(row(0)?.props['zIndex'], 1, 'the year is pinned');
    });
    assert.deepEqual(
      warnings.filter((line) => line.includes('virtualListStickyLevel')),
      [],
    );
  });

  it('says nothing on a list with itemHeight', async () => {
    const warnings = await warned(async () => void (await boot()));
    assert.deepEqual(
      warnings.filter((line) => line.includes('virtualListStickyLevel')),
      [],
    );
  });
});

async function boot(
  setUp?: (instance: Instance) => void,
  options: Parameters<typeof render>[1] = {},
  name = 'VirtualStickyLevels',
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
  const rows = () =>
    flatten(fabric.committed).filter(
      (n) => /^row\d+$/.test(String(n.props['nativeID'] ?? '')) && n.props['opacity'] !== 0,
    );
  /** A row in the window, and not one parked off screen for reuse. */
  const row = (index: number) => rows().find((n) => n.props['nativeID'] === `row${index}`);
  /** Where a row is placed along a vertical list. */
  const at = (index: number) => row(index)?.props['top'];
  // The header wraps the listHeader content; it is the content view's first child.
  const header = () => scrollView().children[0]!.children[0]!;
  const scroll = (y: number) => fireEvent.scroll(scrollView(), { contentOffset: { y } });
  const shown = () =>
    rows()
      .map((n) => Number(String(n.props['nativeID']).slice(3)))
      .sort((a, b) => a - b);
  return { fabric, instance, scrollView, row, at, header, scroll, shown };
}

/** Where a row of the fixture's own entries starts along the list. */
function top(index: number): number {
  return entries()
    .slice(0, index)
    .reduce((sum, entry) => sum + ([YEAR, MONTH, DAY][entry.level ?? -1] ?? 40), 0);
}

/** Where a slot sits across the list, from its insets, resolved against the width. */
function across(node: FakeFabricNode): { x: number; width: number } {
  const side = (physical: string, logical: string) =>
    resolve(node.props[physical] ?? node.props[logical]);
  const left = side('left', 'start') + side('marginLeft', 'marginStart');
  const right = side('right', 'end') + side('marginRight', 'marginEnd');
  return { x: Math.round(left), width: Math.round(WIDTH - left - right) };
}

function resolve(value: unknown): number {
  if (typeof value === 'string' && value.endsWith('%')) return (parseFloat(value) * WIDTH) / 100;
  return typeof value === 'number' ? value : 0;
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
