/**
 * Tabs on macOS render as the window's sidebar. The tabs outlet commits the same views and props
 * as on iOS, and the desktop host draws them differently: `RNSTabsHostIOS` is a split view whose
 * sidebar lists the tabs, and each `RNSTabsScreenIOS` is a sidebar item (its `title` the label,
 * `iconType: 'sfSymbol'` with `iconResourceName` the symbol, `badgeValue` the badge) whose screen
 * goes in the content pane. Selection goes through the tabs host's `navStateRequest` and
 * `tabSelected` as on iOS, so a tab app works unchanged. The tabs host owns the window's split
 * view controller, so a `<split-view>` inside a tab is a plain NSSplitView.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import type { Routes } from '@angular/router';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe('tabs on macOS', () => {
  let mod: Record<string, unknown>;
  const warnings: string[] = [];
  const warn = console.warn;

  before(async () => {
    registerPlatformComponents('macos');
    mod = await compileFixture('fixtures/macos-tabs.ts');
    console.warn = (message: unknown) => void warnings.push(String(message));
  });
  after(() => {
    console.warn = warn;
    registerPlatformComponents('ios');
  });
  afterEach(cleanup);

  it("commits iOS's tabs host and screens, which the host draws as sidebar items", async () => {
    const { fabric } = await render(mod['Bar'] as Type<unknown>, {
      providers: [provideNativeRouter(mod['routes'] as Routes)],
    });
    for (let turn = 0; turn < 5; turn++) await settle();
    const nodes = flatten(fabric.committed);
    assert.ok(nodes.some((node) => node.viewName === 'RNSTabsHostIOS'));
    const tabs = nodes.filter((node) => node.viewName === 'RNSTabsScreenIOS');
    assert.deepEqual(
      tabs.map((tab) => [tab.props['title'], tab.props['iconType'], tab.props['iconResourceName']]),
      [
        ['Library', 'sfSymbol', 'books.vertical'],
        ['Search', undefined, undefined],
      ],
    );
    assert.equal(tabs[0]!.props['badgeValue'], '3');
  });

  it('warns that a tab naming only a drawable has no icon on macOS', () => {
    assert.ok(
      warnings.some((message) => message.includes('path="search"') && message.includes('macOS')),
      warnings.join('\n'),
    );
  });
});
