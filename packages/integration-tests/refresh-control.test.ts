/**
 * Pull to refresh on both platforms. On iOS the refresh control is a child of the scroll view; on
 * Android React Native makes the swipe layout the scroll view's *parent* and moves the layout half
 * of the style onto it, and a swipe layout committed as a child has nothing to wrap and never
 * sees a pull.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerPlatformComponents, registerViewName } from '@ng-native/fabric';
import {
  cleanup,
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
// Not expressible through the query matrix: there is no view-name query, so this stays local.
const find = (fabric: FakeFabric, viewName: string) =>
  flatten(fabric.committed).filter((node) => node.viewName === viewName);
const byID = (fabric: FakeFabric, id: string) =>
  flatten(fabric.committed).find((node) => node.props['nativeID'] === id);
// Not expressible through the query matrix either: no parent-of-child lookup.
const parentOf = (fabric: FakeFabric, child: FakeFabricNode) =>
  flatten(fabric.committed).find((node) => node.children.includes(child));

interface ScrollRefresh {
  shown: { set(value: boolean): void };
  refreshable: { set(value: boolean): void };
  refreshing: { set(value: boolean): void };
  style: { set(value: Record<string, unknown>): void };
  log: string[];
}

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/refresh.ts');
});

async function boot<T>(name: string): Promise<{ fabric: FakeFabric; instance: T }> {
  const { fabric, instance } = await render(mod[name] as Type<T>);
  return { fabric, instance };
}

describe('pull to refresh on iOS', () => {
  it('commits the refresh control inside the scroll view', async () => {
    const { fabric } = await boot<ScrollRefresh>('ScrollRefresh');
    const scroll = find(fabric, 'ScrollView')[0]!;
    assert.equal(
      parentOf(fabric, scroll)?.handle,
      byID(fabric, 'page')?.handle,
      'the scroll view stays put',
    );
    assert.ok(
      flatten([scroll]).some((node) => node.viewName === 'PullToRefreshView'),
      'the refresh control is inside it',
    );
    assert.equal(scroll.props['margin'], 8, 'and the style is not split');
    cleanup();
  });
});

describe('pull to refresh on iOS, where it attaches itself', () => {
  // The native control finds its scroll view by walking up its superviews once, when it is
  // inserted. Fabric mounts a new subtree bottom-up, so a control inside the content view is
  // inserted before the content view is in the scroll view, finds nothing and never attaches:
  // pulling shows no spinner and fires nothing. RN's ScrollView.js commits it as a direct child
  // of the scroll view for this reason.
  for (const name of ['ScrollRefresh', 'ListRefresh', 'SectionRefresh']) {
    it(`commits it as a direct child of the scroll view: ${name}`, async () => {
      const { fabric } = await boot<unknown>(name);
      const scroll = find(fabric, 'ScrollView')[0]!;
      assert.equal(scroll.children[0]?.viewName, 'PullToRefreshView', 'first, as RN puts it');
      assert.equal(find(fabric, 'PullToRefreshView').length, 1, 'and nowhere else');
      cleanup();
    });
  }

  it('attaches one added later as a direct child too', async () => {
    const { fabric, instance } = await boot<ScrollRefresh>('ScrollRefresh');
    instance.refreshable.set(false);
    await settle();
    assert.equal(find(fabric, 'PullToRefreshView').length, 0);
    instance.refreshable.set(true);
    await settle();
    assert.equal(find(fabric, 'ScrollView')[0]!.children[0]?.viewName, 'PullToRefreshView');
    cleanup();
  });
});

describe('pull to refresh on Android', () => {
  before(() => registerPlatformComponents('android'));
  after(() => {
    registerPlatformComponents('ios');
    for (const [element, viewName] of Object.entries({
      switch: 'Switch',
      'text-input': 'TextInput',
      'activity-indicator': 'ActivityIndicatorView',
      'refresh-control': 'PullToRefreshView',
      'safe-area-view': 'SafeAreaView',
      'input-accessory-view': 'InputAccessoryView',
    })) {
      registerViewName(element, viewName);
    }
  });

  const shape = (fabric: FakeFabric) => {
    const layout = find(fabric, 'AndroidSwipeRefreshLayout');
    const scroll = find(fabric, 'ScrollView')[0]!;
    return { layout, scroll, page: byID(fabric, 'page')! };
  };

  it('wraps the scroll view in the swipe layout, where the scroll view was', async () => {
    const { fabric } = await boot<ScrollRefresh>('ScrollRefresh');
    const { layout, scroll, page } = shape(fabric);

    assert.equal(layout.length, 1, 'one swipe layout');
    assert.deepEqual(
      layout[0]!.children.map((node) => node.viewName),
      ['ScrollView'],
      'its only child is the scroll view',
    );
    assert.equal(layout[0]!.children[0]?.handle, scroll.handle);
    assert.deepEqual(
      page.children.map((node) => node.viewName),
      ['Paragraph', 'AndroidSwipeRefreshLayout', 'Paragraph'],
      'the swipe layout takes the scroll view s place between its siblings',
    );
    assert.ok(
      !flatten([scroll]).some((node) => node.viewName === 'AndroidSwipeRefreshLayout'),
      'and is no longer inside it',
    );
    cleanup();
  });

  it('moves the layout props to the swipe layout, as splitLayoutProps does', async () => {
    const { fabric } = await boot<ScrollRefresh>('ScrollRefresh');
    const { layout, scroll } = shape(fabric);
    const outer = layout[0]!.props;

    assert.equal(outer['flex'], 1);
    assert.equal(outer['margin'], 8);
    // RN composes the scroll view's base style under the outer half.
    assert.equal(outer['flexGrow'], 1);
    assert.equal(outer['flexShrink'], 1);
    assert.equal(outer['overflow'], 'scroll');
    assert.equal(outer['backgroundColor'], undefined, 'paint stays on the scroll view');

    assert.equal(scroll.props['backgroundColor'], 'red');
    assert.equal(scroll.props['padding'], 4);
    assert.equal(scroll.props['margin'] ?? null, null, 'no second margin inside the first');
    assert.equal(scroll.props['flex'] ?? null, null);
    assert.equal(scroll.props['flexGrow'], 1, 'the base style fills the swipe layout');
    assert.equal(scroll.props['nestedScrollEnabled'], true, 'RN turns nested scrolling on');
    cleanup();
  });

  it('follows a style change, including a layout prop that goes away', async () => {
    const { fabric, instance } = await boot<ScrollRefresh>('ScrollRefresh');
    instance.style.set({ height: 200, backgroundColor: 'blue' });
    await settle();
    const { layout, scroll } = shape(fabric);

    assert.equal(layout[0]!.props['height'], 200);
    assert.equal(layout[0]!.props['margin'] ?? null, null, 'the removed margin is gone');
    assert.equal(layout[0]!.props['flex'] ?? null, null);
    assert.equal(scroll.props['height'] ?? null, null);
    assert.equal(scroll.props['backgroundColor'], 'blue');
    assert.equal(scroll.props['padding'] ?? null, null);
    cleanup();
  });

  it('fires (refresh) from the swipe layout and commands it', async () => {
    const { fabric, instance } = await boot<ScrollRefresh>('ScrollRefresh');
    const { layout } = shape(fabric);
    await fireEvent(layout[0]!, 'refresh', {});

    assert.deepEqual(instance.log, ['refresh']);
    assert.deepEqual(fabric.commands, [
      { viewName: 'AndroidSwipeRefreshLayout', name: 'setNativeRefreshing', args: [false] },
    ]);
    cleanup();
  });

  it('puts the scroll view back when the refresh control goes, and wraps it again', async () => {
    const { fabric, instance } = await boot<ScrollRefresh>('ScrollRefresh');
    instance.refreshable.set(false);
    await settle();

    let { layout, scroll, page } = shape(fabric);
    assert.equal(layout.length, 0, 'no swipe layout left behind');
    assert.deepEqual(
      page.children.map((node) => node.viewName),
      ['Paragraph', 'ScrollView', 'Paragraph'],
      'the scroll view is back where it was',
    );
    assert.equal(scroll.props['margin'], 8, 'with its whole style');
    assert.equal(scroll.props['flex'], 1);

    instance.refreshable.set(true);
    await settle();
    ({ layout, scroll, page } = shape(fabric));
    assert.equal(layout.length, 1);
    assert.equal(layout[0]!.children[0]?.handle, scroll.handle);
    assert.equal(page.children[1]?.handle, layout[0]!.handle);
    cleanup();
  });

  it('leaves nothing behind when the scroll view itself goes', async () => {
    const { fabric, instance } = await boot<ScrollRefresh>('ScrollRefresh');
    instance.shown.set(false);
    await settle();

    const { layout, page } = shape(fabric);
    assert.equal(layout.length, 0);
    assert.deepEqual(
      page.children.map((node) => node.viewName),
      ['Paragraph', 'Paragraph'],
    );

    instance.shown.set(true);
    await settle();
    assert.deepEqual(
      shape(fabric).page.children.map((node) => node.viewName),
      ['Paragraph', 'AndroidSwipeRefreshLayout', 'Paragraph'],
    );
    cleanup();
  });

  it('wraps a virtual list the same way', async () => {
    const { fabric, instance } = await boot<{ log: string[] }>('ListRefresh');
    const { layout, scroll, page } = shape(fabric);

    assert.equal(layout.length, 1);
    assert.equal(layout[0]!.children[0]?.handle, scroll.handle);
    assert.equal(page.children[0]?.handle, layout[0]!.handle);
    assert.equal(layout[0]!.props['height'], 300);
    assert.equal(layout[0]!.props['marginTop'], 10);
    assert.equal(scroll.props['marginTop'] ?? null, null);

    await fireEvent(layout[0]!, 'refresh', {});
    assert.deepEqual(instance.log, ['refresh']);
    cleanup();
  });

  it('wraps the list inside a section list, which the control is projected through', async () => {
    const { fabric, instance } = await boot<{ log: string[] }>('SectionRefresh');
    const { layout, scroll } = shape(fabric);

    assert.equal(layout.length, 1);
    assert.equal(layout[0]!.children[0]?.handle, scroll.handle);
    assert.equal(scroll.props['nestedScrollEnabled'], true);
    await fireEvent(layout[0]!, 'refresh', {});
    assert.deepEqual(instance.log, ['refresh']);
    cleanup();
  });
});
