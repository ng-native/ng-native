/**
 * A screen's bottom toolbar: `<native-toolbar>` and its `<native-toolbar-item>`s, committed as
 * Expo Router's native toolbar views. The host finds the react-native-screens screen it is in and
 * gives it its items, so what is pinned here is what those views read: the host's children in
 * order, each with an identifier of its own, its type and its props, and the event a tap sends.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, fireEvent, render, type FakeFabricNode } from '@ng-native/testing';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

interface Host {
  readonly composing: { set(value: boolean): void };
  readonly busy: { set(value: boolean): void };
  filtered: number;
  composed: number;
}

const HOST = 'ViewManagerAdapter_ExpoRouterToolbarModule_RouterToolbarHostView';
const ITEM = 'ViewManagerAdapter_ExpoRouterToolbarModule_RouterToolbarItemView';

describe('native toolbar', () => {
  let Toolbar: Type<Host>;

  before(async () => {
    registerScreenComponents();
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/toolbar.ts', import.meta.url)),
    );
    Toolbar = mod['ToolbarHost'] as Type<Host>;
  });

  afterEach(() => cleanup());
  after(() => {
    registerPlatformComponents('ios');
    registerScreenComponents();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function boot() {
    const { fabric, instance, fixture } = await render(Toolbar);
    const host = () => fabric.find(HOST)!;
    const items = (): FakeFabricNode[] => host().children;
    const pass = async () => {
      fixture.detectChanges();
      await settle();
    };
    return { fabric, host, items, pass, instance: instance as Host };
  }

  it("commits Expo Router's toolbar host, out of the screen's layout as its own wrapper has it", async () => {
    const { host } = await boot();
    assert.ok(host(), 'the element is the native host itself');
    const { position, top, left, width, height } = host().props;
    assert.deepEqual(
      { position, top, left, width, height },
      {
        position: 'absolute',
        top: 0,
        left: 0,
        width: 1,
        height: 1,
      },
    );
  });

  it('gives the host each item in the order written, as the item view', async () => {
    const { items } = await boot();
    assert.deepEqual(
      items().map((item) => item.viewName),
      [ITEM, ITEM, ITEM, ITEM, ITEM],
    );
    assert.deepEqual(
      items().map((item) => item.props['type']),
      [undefined, 'fluidSpacer', 'searchBar', 'fixedSpacer', undefined],
      'a button says nothing, which native reads as one',
    );
  });

  it('sends a button its symbol, title, style and label, and a spacer its width', async () => {
    const { items } = await boot();
    const [filter, fluid, , fixed, compose] = items();
    assert.equal(filter!.props['systemImageName'], 'line.3.horizontal.decrease');
    assert.equal(filter!.props['accessibilityLabel'], 'Filter');
    assert.equal(filter!.props['title'], undefined, 'an unset input never reaches native');
    assert.equal(filter!.props['hidesSharedBackground'], undefined);
    assert.equal(fluid!.props['width'], undefined);
    assert.equal(fixed!.props['width'], 12, 'a number, as native reads it');
    assert.equal(compose!.props['title'], 'Compose');
    assert.equal(compose!.props['barButtonItemStyle'], 'prominent');
    assert.equal(compose!.props['hidesSharedBackground'], true);
    assert.equal(compose!.props['disabled'], false);
  });

  it('gives every item an identifier of its own, which native will not mount one without', async () => {
    const { items, instance, pass } = await boot();
    const identifiers = items().map((item) => item.props['identifier']);
    for (const identifier of identifiers) {
      assert.equal(typeof identifier, 'string');
      assert.notEqual(identifier, '');
    }
    assert.equal(new Set(identifiers).size, identifiers.length);

    instance.busy.set(true);
    await pass();
    assert.equal(items()[4]!.props['disabled'], true);
    assert.deepEqual(
      items().map((item) => item.props['identifier']),
      identifiers,
      'and keeps it as its props change',
    );
  });

  it('reports a tap on a button as a press', async () => {
    const { items, instance } = await boot();
    await fireEvent(items()[0]!, 'selected', {});
    assert.equal(instance.filtered, 1);
    assert.equal(instance.composed, 0);
    await fireEvent(items()[4]!, 'selected', {});
    await fireEvent(items()[4]!, 'selected', {});
    assert.equal(instance.composed, 2);
  });

  it('takes an item out of the toolbar when it goes, and puts it back where it was', async () => {
    const { items, instance, pass } = await boot();
    instance.composing.set(false);
    await pass();
    assert.equal(items().length, 4);
    assert.equal(
      items().some((item) => item.props['title'] === 'Compose'),
      false,
    );

    instance.composing.set(true);
    await pass();
    assert.equal(items().length, 5);
    assert.equal(items()[4]!.props['title'], 'Compose', 'last, as written');
  });

  it('names the views as Expo Go does, with the app it is running', async () => {
    const scope = globalThis as { expo?: unknown };
    const before = scope.expo;
    try {
      scope.expo = { __expo_app_identifier__: 'canary_1' };
      registerScreenComponents();
      const { fabric } = await render(Toolbar);
      assert.ok(fabric.find(`${HOST}_canary_1`));
      assert.equal(fabric.find(`${HOST}_canary_1`)!.children[0]!.viewName, `${ITEM}_canary_1`);
    } finally {
      scope.expo = before;
      registerScreenComponents();
    }
  });

  it('is a plain view on Android, which has no such toolbar', async () => {
    registerPlatformComponents('android');
    try {
      const { fabric } = await render(Toolbar);
      assert.equal(fabric.find(HOST), undefined);
      assert.equal(fabric.find(ITEM), undefined);
    } finally {
      registerPlatformComponents('ios');
    }
  });
});
