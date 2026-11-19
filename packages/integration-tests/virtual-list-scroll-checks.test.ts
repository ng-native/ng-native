/**
 * A scroll event that moves no row in or out of the window checks nothing: the list listens for
 * it outside Angular's listeners, which mark every view above them dirty on each event.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { fireEvent, render, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
const textOf = (fabric: FakeFabric, id: string) =>
  flatten(flatten(fabric.committed).filter((node) => node.props['nativeID'] === id))
    .map((node) => node.props['text'])
    .find((text) => typeof text === 'string');

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/virtual-scroll-checks.ts');
});

/** Render a fixture laid out at 400 points, run the test on it, and unmount it whatever happens. */
async function withList(
  name: string,
  test: (list: { fabric: FakeFabric; host: FakeFabricNode }) => Promise<void>,
): Promise<void> {
  const rendered = await render(mod[name] as Type<unknown>);
  try {
    const host = flatten(rendered.fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(host, 'layout', { layout: { height: 400 } });
    await test({ fabric: rendered.fabric, host });
  } finally {
    rendered.unmount();
  }
}

describe('windowed list scroll events and change detection', () => {
  it('checks the screen for no scroll event that leaves the window as it was', async () => {
    await withList('VirtualScrollChecks', async ({ fabric, host }) => {
      await fireEvent.scroll(host, { contentOffset: { y: 400 } });
      const before = Number(textOf(fabric, 'checks'));
      // Inside row 10, each time: the window stays rows 6 to 24.
      for (const y of [405, 410, 415, 420]) await fireEvent.scroll(host, { contentOffset: { y } });
      assert.equal(Number(textOf(fabric, 'checks')), before);
    });
  });

  it('still renders the rows a scroll brings into the window', async () => {
    await withList('VirtualScrollChecks', async ({ fabric, host }) => {
      await fireEvent.scroll(host, { contentOffset: { y: 50 * 40 } });
      const rows = flatten(fabric.committed)
        .map((node) => node.props['text'])
        .filter((text) => typeof text === 'string');
      assert.ok(rows.includes('row 50'), rows.join(', '));
    });
  });

  it('shows what an endReached handler writes to a plain field', async () => {
    await withList('VirtualScrollChecks', async ({ fabric, host }) => {
      await fireEvent.scroll(host, { contentOffset: { y: 90 * 40 } });
      assert.equal(textOf(fabric, 'ended'), '1');
    });
  });

  it('runs a scroll handler of the screen s own, and shows what it writes', async () => {
    await withList('VirtualScrollHandler', async ({ fabric, host }) => {
      await fireEvent.scroll(host, { contentOffset: { y: 5 } });
      await fireEvent.scroll(host, { contentOffset: { y: 10 } });
      assert.equal(textOf(fabric, 'scrolled'), '2');
    });
  });
});
