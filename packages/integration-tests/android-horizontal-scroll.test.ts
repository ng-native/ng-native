/**
 * A horizontal scroll view on Android is a view of its own. React Native's `ScrollView.js` commits
 * `AndroidHorizontalScrollView` when `horizontal` is set, with `AndroidHorizontalScrollContentView`
 * as its content, and `ScrollView` with a plain `View` otherwise. The vertical manager ignores
 * `horizontal`, and the native view is chosen once, when it is created, so a scroll view turned
 * horizontal after it was made stays a vertical one that a sideways drag does nothing to. React
 * remounts there, as the element is another component; so does the engine. iOS has one scroll
 * view for both axes and takes `horizontal` as a prop.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine, registerPlatformComponents } from '@ng-native/fabric';
import {
  cleanup,
  createFakeFabric,
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
  flatten(fabric.committed).find((node) => node.props['nativeID'] === id)!;

interface Turning {
  horizontal: { set(value: boolean): void };
  scroll(): { scrollTo(o: object): void; scrollToEnd(): void };
}

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/horizontal-scroll.ts');
});

async function boot<T>(name: string): Promise<{ fabric: FakeFabric; instance: T }> {
  const { fabric, instance } = await render(mod[name] as Type<T>);
  return { fabric, instance };
}

describe('a horizontal scroll view on Android', () => {
  before(() => registerPlatformComponents('android'));
  after(() => {
    registerPlatformComponents('ios');
    cleanup();
  });

  it('commits the horizontal scroll view and its content view, and a vertical one after', async () => {
    const { fabric, instance } = await boot<Turning>('TurningScroll');
    instance.horizontal.set(true);
    await settle();
    const scroll = byID(fabric, 'scroll');
    assert.equal(scroll.viewName, 'AndroidHorizontalScrollView');
    assert.equal(scroll.children[0]?.viewName, 'AndroidHorizontalScrollContentView');
    assert.equal(scroll.props['horizontal'], true, 'which RN passes it too');
    assert.equal(scroll.props['showsHorizontalScrollIndicator'], false);
    assert.equal(scroll.props['overflow'], 'scroll', "with ScrollView.js's base style");
    assert.equal(scroll.props['flexDirection'], 'row');
    assert.equal(find(fabric, 'ScrollView').length, 0, 'and no vertical one left behind');
    assert.ok(byID(fabric, 'item'), 'its content went with it');
    cleanup();
  });

  it('is made again when horizontal turns, either way, as React remounts it', async () => {
    const { fabric, instance } = await boot<Turning>('TurningScroll');
    const vertical = byID(fabric, 'scroll');
    assert.equal(vertical.viewName, 'ScrollView');
    assert.equal(vertical.children[0]?.viewName, 'View');

    instance.horizontal.set(true);
    await settle();
    const horizontal = byID(fabric, 'scroll');
    assert.equal(horizontal.viewName, 'AndroidHorizontalScrollView');
    assert.notEqual(horizontal.reactTag, vertical.reactTag, 'another native view, not a clone');
    assert.equal(horizontal.children[0]?.viewName, 'AndroidHorizontalScrollContentView');

    instance.horizontal.set(false);
    await settle();
    const back = byID(fabric, 'scroll');
    assert.equal(back.viewName, 'ScrollView');
    assert.notEqual(back.reactTag, horizontal.reactTag);
    assert.equal(back.children[0]?.viewName, 'View');
    assert.equal(back.props['flexDirection'], 'column');
    assert.equal(find(fabric, 'AndroidHorizontalScrollView').length, 0);
    cleanup();
  });

  it('sends scroll commands to the view it is now', async () => {
    const { fabric, instance } = await boot<Turning>('TurningScroll');
    instance.horizontal.set(true);
    await settle();
    instance.scroll().scrollTo({ x: 40 });
    instance.scroll().scrollToEnd();
    assert.deepEqual(
      fabric.commands.map((c) => [c.viewName, c.name, c.node?.reactTag]),
      [
        ['AndroidHorizontalScrollView', 'scrollTo', byID(fabric, 'scroll').reactTag],
        ['AndroidHorizontalScrollView', 'scrollToEnd', byID(fabric, 'scroll').reactTag],
      ],
    );
    cleanup();
  });

  it('commits a horizontal virtual list the same way, and a vertical one once it turns', async () => {
    const { fabric, instance } = await boot<Turning>('TurningList');
    const list = byID(fabric, 'list');
    assert.equal(list.viewName, 'AndroidHorizontalScrollView');
    assert.equal(list.children[0]?.viewName, 'AndroidHorizontalScrollContentView');
    assert.equal(list.children.length, 1, 'one content view, as Android takes');

    instance.horizontal.set(false);
    await settle();
    const vertical = byID(fabric, 'list');
    assert.equal(vertical.viewName, 'ScrollView');
    assert.equal(vertical.children[0]?.viewName, 'View');
    cleanup();
  });

  it('is made again inside the swipe layout that wraps it, which stays', async () => {
    const { fabric, instance } = await boot<Turning>('TurningRefresh');
    const [layout] = find(fabric, 'AndroidSwipeRefreshLayout');
    assert.equal(layout?.children[0]?.viewName, 'ScrollView');
    instance.horizontal.set(true);
    await settle();
    const layouts = find(fabric, 'AndroidSwipeRefreshLayout');
    assert.equal(layouts.length, 1);
    assert.equal(layouts[0]?.reactTag, layout?.reactTag, 'the layout is the same view');
    assert.equal(byID(fabric, 'page').children[0], layouts[0], 'still where it was');
    const scroll = layouts[0]!.children[0]!;
    assert.equal(scroll.viewName, 'AndroidHorizontalScrollView', 'the scroll view is under it');
    assert.equal(scroll.children.length, 1, 'holding its content view and nothing else');
    assert.equal(scroll.children[0]?.viewName, 'AndroidHorizontalScrollContentView');
    cleanup();
  });

  it('names the native views the same with no component on the element', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const scroll = engine.createElement('scroll-view');
    const content = engine.createElement('view');
    engine.appendChild(scroll, content);
    engine.appendChild(engine.root, scroll);
    engine.setProp(scroll, 'horizontal', true);
    engine.commit();
    assert.equal(fabric.committed[0]?.viewName, 'AndroidHorizontalScrollView');
    assert.equal(fabric.committed[0]?.children[0]?.viewName, 'AndroidHorizontalScrollContentView');
    engine.setProp(scroll, 'horizontal', null);
    engine.commit();
    assert.equal(fabric.committed[0]?.viewName, 'ScrollView');
    assert.equal(fabric.committed[0]?.children[0]?.viewName, 'View');
  });

  it('lays a child out along the row its default direction makes, with no component on it', () => {
    // Nothing binds `flexDirection`, so the row is the horizontal scroll view's default alone.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const scroll = engine.createElement('scroll-view');
    const content = engine.createElement('view');
    engine.setProp(content, 'style', { flexBasis: 120 });
    engine.appendChild(scroll, content);
    engine.appendChild(engine.root, scroll);
    engine.setProp(scroll, 'horizontal', true);
    engine.commit();
    const committed = fabric.committed[0]!;
    assert.equal(committed.props['flexDirection'], 'row');
    assert.equal(committed.children[0]?.props['width'], 120, 'the basis is a width in a row');
    assert.equal(committed.children[0]?.props['height'], undefined);
    engine.setProp(scroll, 'horizontal', null);
    engine.commit();
    const vertical = fabric.committed[0]!.children[0]!;
    assert.equal(vertical.props['height'], 120, 'and a height again in a column');
    assert.equal(vertical.props['width'], undefined);
  });

  it('raises the content view over its siblings with what it holds, as a plain view is', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const scroll = engine.createElement('scroll-view');
    const content = engine.createElement('view');
    const raised = engine.createElement('view');
    engine.setProp(raised, 'zIndex', 2);
    engine.appendChild(content, raised);
    engine.appendChild(scroll, content);
    engine.appendChild(engine.root, scroll);
    engine.setProp(scroll, 'horizontal', true);
    engine.commit();
    const committed = fabric.committed[0]?.children[0];
    assert.equal(committed?.viewName, 'AndroidHorizontalScrollContentView');
    assert.equal(committed?.props['zIndex'], 2);
  });

  it('puts a markdown table in one, so it can be dragged across', async () => {
    const { fabric } = await boot<unknown>('MarkdownTable');
    const [table] = find(fabric, 'AndroidHorizontalScrollView');
    assert.ok(table, 'the table scrolls sideways');
    assert.equal(table.children[0]?.viewName, 'AndroidHorizontalScrollContentView');
    assert.equal(find(fabric, 'ScrollView').length, 0);
    cleanup();
  });
});

describe('a horizontal scroll view on iOS', () => {
  it('stays one scroll view that takes horizontal as a prop, turned in place', async () => {
    const { fabric, instance } = await boot<Turning>('TurningScroll');
    const vertical = byID(fabric, 'scroll');
    instance.horizontal.set(true);
    await settle();
    const horizontal = byID(fabric, 'scroll');
    assert.equal(horizontal.viewName, 'ScrollView');
    assert.equal(horizontal.reactTag, vertical.reactTag, 'the same native view, cloned');
    assert.equal(horizontal.props['horizontal'], true);
    assert.equal(horizontal.children[0]?.viewName, 'View');
    assert.equal(find(fabric, 'AndroidHorizontalScrollView').length, 0);
    cleanup();
  });
});
