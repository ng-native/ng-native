/**
 * The section list: RN's SectionList, which is a windowed list over flattened header, item and
 * footer rows, and so is this one.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { registerPlatformComponents, registerViewName } from '@ng-native/fabric';
import { render, screen, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
const textOf = (node: FakeFabricNode) =>
  flatten([node])
    .map((n) => n.props['text'])
    .filter((t) => typeof t === 'string')
    .join('');
const all = (fabric: FakeFabric, id: string) => screen.getAllByTestId(id).map(textOf);
// No query equivalent: found by view name, not by an id or accessible name/role.
const scrollView = (fabric: FakeFabric) =>
  flatten(fabric.committed).find((node) => node.viewName === 'ScrollView')!;
/** The row slot holding a node with this text. */
const slotOf = (fabric: FakeFabric, text: string) =>
  flatten(fabric.committed).find(
    (node) => node.props['position'] === 'absolute' && textOf(node) === text,
  );
/** The row slot whose text includes this text, read as one string in draw order. */
const slotTextAround = (fabric: FakeFabric, text: string) =>
  textOf(
    flatten(fabric.committed).find(
      (node) => node.props['position'] === 'absolute' && textOf(node).includes(text),
    )!,
  );

// Each section is a 30 header, five 40 items and a 10 footer.
const SECTION = 30 + 5 * 40 + 10;

interface SectionsList {
  sticky: { set(value: boolean | undefined): void };
  list(): {
    scrollToLocation(options: {
      sectionIndex: number;
      itemIndex: number;
      viewOffset?: number;
    }): void;
  };
  ended: number;
}

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(fileURLToPath(new URL('./fixtures/section-list.ts', import.meta.url)));
});

async function boot(height = 300) {
  const app = await render(mod['SectionsList'] as Type<unknown>);
  const fabric = app.fabric;
  fabric.emit(scrollView(fabric), 'topLayout', { layout: { height } });
  await settle();
  return { fabric, app, instance: app.instance as SectionsList };
}

async function scrollTo(fabric: FakeFabric, y: number) {
  fabric.emit(scrollView(fabric), 'topScroll', { contentOffset: { y } });
  await settle();
}

describe('flattening sections', () => {
  it('gives each section a header, its items, then a footer', () => {
    const flattenSections = mod['flattenSections'] as (
      sections: { title: string; data: string[] }[],
    ) => { kind: string; separator: unknown }[];
    const rows = flattenSections([
      { title: 'A', data: ['a0', 'a1'] },
      { title: 'B', data: [] },
    ]);
    assert.deepEqual(
      rows.map((row) => row.kind),
      ['header', 'item', 'item', 'footer', 'header', 'footer'],
    );
    assert.ok(rows[1]!.separator, 'the first item is followed by a separator');
    assert.equal(rows[2]!.separator, null, 'the last item of a section is not');
  });

  it('puts a section separator before the first item and after the last, as RN does', () => {
    const flattenSections = mod['flattenSections'] as (
      sections: { title: string; data: string[] }[],
    ) => {
      kind: string;
      leading: Record<string, unknown> | null;
      trailing: Record<string, unknown> | null;
    }[];
    const [a, b, c] = [
      { title: 'A', data: ['a0', 'a1', 'a2'] },
      { title: 'B', data: [] },
      { title: 'C', data: ['c0'] },
    ];
    const rows = flattenSections([a, b, c]);
    const items = rows.filter((row) => row.kind === 'item');
    assert.deepEqual(items[0]!.leading, {
      $implicit: a,
      section: a,
      leadingItem: undefined,
      leadingSection: undefined,
      trailingItem: 'a0',
      trailingSection: b,
    });
    assert.equal(items[0]!.trailing, null, 'not after the first item');
    assert.equal(items[1]!.leading, null, 'nothing around a middle item');
    assert.equal(items[1]!.trailing, null);
    assert.equal(items[2]!.leading, null);
    assert.deepEqual(items[2]!.trailing, {
      $implicit: a,
      section: a,
      leadingItem: 'a2',
      leadingSection: undefined,
      trailingItem: undefined,
      trailingSection: b,
    });
    // An empty section has no item to draw one around, so it draws none, as RN's does not.
    assert.deepEqual(
      rows.filter((row) => row.kind !== 'item').map((row) => [row.leading, row.trailing]),
      Array.from({ length: 6 }, () => [null, null]),
    );
    // A single item is both first and last, so it gets both.
    assert.equal(items[3]!.leading?.['leadingSection'], b);
    assert.equal(items[3]!.leading?.['trailingItem'], 'c0');
    assert.equal(items[3]!.trailing?.['leadingItem'], 'c0');
    assert.equal(items[3]!.trailing?.['trailingSection'], undefined);
  });
});

describe('section list', () => {
  it('draws headers, items and footers from their templates', async () => {
    const { fabric, app } = await boot();
    assert.deepEqual(all(fabric, 'header').slice(0, 2), ['S0#0', 'S1#1']);
    assert.deepEqual(all(fabric, 'item').slice(0, 2), ['S0.0=i0-0', 'S0.1=i0-1']);
    assert.equal(all(fabric, 'footer')[0], 'end S0');
    app.unmount();
  });

  it('places each row at its offset in the flattened list', async () => {
    const { fabric, app } = await boot();
    assert.equal(slotOf(fabric, 'S0#0')?.props['top'], 0);
    assert.equal(slotOf(fabric, 'S0#0')?.props['height'], 30);
    assert.equal(slotOf(fabric, 'end S0')?.props['top'], 30 + 5 * 40);
    assert.equal(slotOf(fabric, 'S1#1')?.props['top'], SECTION);
    app.unmount();
  });

  it('separates items of one section, and not a section from the next', async () => {
    const { fabric, app } = await boot();
    const separators = all(fabric, 'separator');
    assert.deepEqual(separators.slice(0, 4), ['i0-0|i0-1', 'i0-1|i0-2', 'i0-2|i0-3', 'i0-3|i0-4']);
    assert.ok(!separators.some((text) => text.startsWith('i0-4|')), 'none after the last item');
    app.unmount();
  });

  it('draws the section separator at each edge of a section, told both neighbours', async () => {
    const { fabric, app } = await boot();
    // The window ends inside the second section, so its trailing edge is not drawn yet.
    assert.deepEqual(all(fabric, 'edge').slice(0, 3), [
      '[S0]S1:|i0-0',
      '[S0]S1:i0-4|',
      'S0[S1]S2:|i1-0',
    ]);
    app.unmount();
  });

  it('draws it inside the first and last item slots, where RN draws its cell separators', async () => {
    const { fabric, app } = await boot();
    // The leading one draws before the item, and the item separator still follows the item.
    assert.equal(slotTextAround(fabric, 'S0.0=i0-0'), '[S0]S1:|i0-0' + 'S0.0=i0-0' + 'i0-0|i0-1');
    // The trailing one takes the place of the item separator after the last item.
    assert.equal(slotTextAround(fabric, 'S0.4=i0-4'), 'S0.4=i0-4' + '[S0]S1:i0-4|');
    assert.equal(slotTextAround(fabric, 'S0.2=i0-2'), 'S0.2=i0-2' + 'i0-2|i0-3');
    app.unmount();
  });

  it('renders only a window of a long list', async () => {
    const { fabric, app } = await boot();
    await scrollTo(fabric, 10 * SECTION);
    const headers = all(fabric, 'header');
    assert.ok(headers.includes('S10#10'), headers.join(', '));
    assert.ok(!headers.includes('S0#0'), 'the first section has gone');
    assert.ok(all(fabric, 'item').length < 15, 'nowhere near a hundred items');
    app.unmount();
  });

  it('pins the current section header by default on iOS', async () => {
    const { fabric, app } = await boot();
    await scrollTo(fabric, 3 * SECTION + 100);
    const pinned = slotOf(fabric, 'S3#3')!;
    assert.equal(pinned.props['zIndex'], 1);
    assert.equal(pinned.props['top'], 3 * SECTION + 100, 'riding the offset');
    app.unmount();
  });

  it('pins nothing when sticky headers are turned off', async () => {
    const { fabric, app, instance } = await boot();
    instance.sticky.set(false);
    await settle();
    await scrollTo(fabric, 3 * SECTION + 100);
    assert.ok(!slotOf(fabric, 'S3#3'), 'the header scrolled away with its section');
    app.unmount();
  });

  it('fires endReached near the end of the last section', async () => {
    const { fabric, app, instance } = await boot();
    assert.equal(instance.ended, 0);
    await scrollTo(fabric, 20 * SECTION - 400);
    assert.equal(instance.ended, 1);
    app.unmount();
  });

  it('fires endReached again after scrolling away from the end, so a failed load can retry', async () => {
    const { fabric, app, instance } = await boot();
    await scrollTo(fabric, 20 * SECTION - 400);
    await scrollTo(fabric, 20 * SECTION - 380);
    assert.equal(instance.ended, 1, 'once while it stays near the end');
    await scrollTo(fabric, 0);
    await scrollTo(fabric, 20 * SECTION - 400);
    assert.equal(instance.ended, 2);
    app.unmount();
  });

  it('scrolls to a location, allowing for the pinned header', async () => {
    const { fabric, app, instance } = await boot();
    instance.list().scrollToLocation({ sectionIndex: 2, itemIndex: 1 });
    // Row 1 of section 2 is its first item, 30 below the section's start; with the header pinned
    // over it, the list stops the header's height short so the item shows.
    assert.deepEqual(fabric.commands.at(-1), {
      viewName: 'ScrollView',
      name: 'scrollTo',
      args: [0, 2 * SECTION + 30 - 30, true],
    });

    instance.sticky.set(false);
    await settle();
    instance.list().scrollToLocation({ sectionIndex: 2, itemIndex: 3, viewOffset: 5 });
    assert.deepEqual(fabric.commands.at(-1)?.args, [0, 2 * SECTION + 30 + 2 * 40 - 5, true]);
    app.unmount();
  });
});

describe('section list on Android', () => {
  before(() => registerPlatformComponents('android'));
  after(() => {
    registerPlatformComponents('ios');
    registerViewName('refresh-control', 'PullToRefreshView');
    registerViewName('switch', 'Switch');
    registerViewName('text-input', 'TextInput');
    registerViewName('activity-indicator', 'ActivityIndicatorView');
    registerViewName('safe-area-view', 'SafeAreaView');
    registerViewName('input-accessory-view', 'InputAccessoryView');
  });

  it('pins the header for a bare stickySectionHeadersEnabled, which arrives as an empty string', async () => {
    // Headers do not pin here unless asked, and a bare attribute is how a template asks.
    const { fabric, app, instance } = await boot();
    instance.sticky.set('' as never);
    await settle();
    await scrollTo(fabric, 3 * SECTION + 100);
    assert.equal(slotOf(fabric, 'S3#3')?.props['zIndex'], 1);
    app.unmount();
  });

  it('does not pin headers by default, as RN does not', async () => {
    const { fabric, app } = await boot();
    await scrollTo(fabric, 3 * SECTION + 100);
    assert.ok(!slotOf(fabric, 'S3#3'), 'the header scrolled away with its section');
    app.unmount();
  });
});
