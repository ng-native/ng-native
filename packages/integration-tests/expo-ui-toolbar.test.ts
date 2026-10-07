/**
 * SwiftUI's toolbar: `ui-navigation-stack`, `ui-toolbar` and `ui-toolbar-item`, and the items a
 * `ui-bottom-sheet` lifts into a toolbar of its own, which is how a sheet shows the system's close
 * button. What is pinned here is the tree native is committed, as `@expo/ui`'s `ToolbarView` reads
 * it: the view the toolbar belongs to, and a `content` slot of `item` slots.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { InjectionToken, Type } from '@angular/core';
import { registerExpoUiViews } from '@ng-native/expo';
import { registerPlatformComponents } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Writable<T> {
  (): T;
  set(value: T): void;
}

interface SheetFixture {
  readonly open: Writable<boolean>;
  readonly closable: Writable<boolean>;
  readonly fit: Writable<boolean>;
}

const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...all(node.children)]);

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

let Toolbar: Type<unknown>;
let Sheet: Type<SheetFixture>;
let UiBottomSheet: {
  readonly SOURCE: InjectionToken<unknown>;
  readonly TOOLBAR: InjectionToken<boolean>;
};

before(async () => {
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/expo-ui-toolbar.ts', import.meta.url)),
  );
  Toolbar = mod['ExpoUiToolbarFixture'] as Type<unknown>;
  Sheet = mod['ExpoUiSheetToolbarFixture'] as Type<SheetFixture>;
  UiBottomSheet = mod['UiBottomSheet'] as typeof UiBottomSheet;
});

after(() => {
  registerPlatformComponents('ios');
  registerExpoUiViews('ios');
});

/**
 * `toolbar` is whether the build has SwiftUI's toolbar, which a device answers for itself; left
 * out, the component asks `expo.getViewConfig` as it does on one.
 */
async function boot<T>(
  platform: 'ios' | 'android',
  fixture: Type<T>,
  toolbar: boolean | null = true,
) {
  registerPlatformComponents(platform);
  registerExpoUiViews(platform);
  const fabric = createFakeFabric();
  const app = mount(1, fixture, fabric, {
    conditions: { width: 390, height: 844, colorScheme: 'light' },
    providers: [
      { provide: UiBottomSheet.SOURCE, useValue: {} },
      ...(toolbar === null ? [] : [{ provide: UiBottomSheet.TOOLBAR, useValue: toolbar }]),
    ],
  });
  await settled();
  const every = (view: string) =>
    all(fabric.committed).filter((node) => node.viewName.endsWith(`ExpoUI_${view}`));
  const byId = (id: string) => all(fabric.committed).find((n) => n.props['testID'] === id);
  const pass = async () => {
    app.applicationRef.tick();
    await settled();
  };
  return { fabric, every, byId, pass, instance: app.componentRef.instance as T };
}

/** A node's children that are the `ExpoUI` view named. */
const childrenNamed = (node: FakeFabricNode, view: string) =>
  node.children.filter((child) => child.viewName.endsWith(`ExpoUI_${view}`));

describe('a SwiftUI toolbar written out', () => {
  it('is a navigation stack around the toolbar, whose view comes before its content slot', async () => {
    const { every } = await boot('ios', Toolbar);
    const [stack] = every('NavigationStackView');
    assert.ok(stack, 'the stack is the native view');
    const [toolbar] = childrenNamed(stack, 'ToolbarView');
    assert.ok(toolbar, 'and the toolbar is inside it');
    assert.equal(childrenNamed(toolbar, 'TextView').length, 1, 'the view the toolbar belongs to');
    const [content] = childrenNamed(toolbar, 'SlotView');
    assert.equal(content!.props['name'], 'content');
  });

  it('sends each item as a slot named item, with where it is placed', async () => {
    const { every } = await boot('ios', Toolbar);
    const content = every('SlotView').find((slot) => slot.props['name'] === 'content')!;
    const [placed, automatic] = childrenNamed(content, 'SlotView');
    assert.equal(placed!.props['name'], 'item');
    assert.deepEqual(placed!.props['extraProps'], { placement: 'topBarTrailing' });
    assert.equal(automatic!.props['name'], 'item');
    assert.deepEqual(automatic!.props['extraProps'] ?? {}, {}, 'SwiftUI places it by itself');
  });

  it('sends a button the close role, which the system draws as its own close button', async () => {
    const { every } = await boot('ios', Toolbar);
    const [close, share] = every('Button');
    assert.equal(close!.props['role'], 'close');
    assert.equal(share!.props['role'], undefined);
  });
});

describe('a toolbar item written in a bottom sheet', () => {
  it('is lifted into a toolbar around the content, inside a navigation stack', async () => {
    const { every, byId } = await boot('ios', Sheet);
    const [group] = every('GroupView');
    const [stack] = childrenNamed(group!, 'NavigationStackView');
    assert.ok(stack, 'under the group that carries how the sheet is presented');
    const [toolbar] = childrenNamed(stack, 'ToolbarView');
    const [host] = childrenNamed(toolbar!, 'RNHostView');
    assert.ok(all([host!]).includes(byId('body')!), 'the content is the view the toolbar is on');

    const [content] = childrenNamed(toolbar!, 'SlotView');
    assert.equal(content!.props['name'], 'content');
    const [item] = childrenNamed(content!, 'SlotView');
    assert.equal(item!.props['name'], 'item');
    assert.deepEqual(item!.props['extraProps'], { placement: 'cancellationAction' });
    assert.equal(childrenNamed(item!, 'Button')[0], byId('close'));
    assert.equal(all([host!]).includes(byId('close')!), false, 'not among the content');
  });

  it('rests at half and full height, not at the height of its content, which the bar is not part of', async () => {
    // A navigation stack fills what it is given, so a sheet sized to its content came out taller
    // than the content, with the content in the middle of it.
    const { fabric, every, instance, pass } = await boot('ios', Sheet);
    instance.open.set(false);
    await pass();
    fabric.emit(every('BottomSheetView')[0]!, 'topDismiss', {});
    await pass();
    instance.fit.set(true);
    instance.open.set(true);
    await pass();
    assert.notEqual(every('BottomSheetView')[0]!.props['fitToContents'], true);
    const modifiers = every('GroupView')[0]!.props['modifiers'] as { $type: string }[];
    assert.deepEqual(
      modifiers.find((modifier) => modifier.$type === 'presentationDetents'),
      { $type: 'presentationDetents', detents: ['medium', 'large'] },
    );
    assert.equal(every('RNHostView')[0]!.props['matchContents'], undefined);
  });

  it('closes the sheet from its close button', async () => {
    const { fabric, every, byId, instance, pass } = await boot('ios', Sheet);
    fabric.emit(byId('close')!, 'topButtonPress', {});
    await pass();
    assert.equal(instance.open(), false);
    assert.equal(every('BottomSheetView')[0]!.props['isPresented'], false);
  });

  it('leaves a sheet with no item as it was, with no navigation stack', async () => {
    const { every, byId, instance, pass } = await boot('ios', Sheet);
    instance.closable.set(false);
    await pass();
    assert.deepEqual(every('NavigationStackView'), [], 'the item went, and the bar with it');
    assert.deepEqual(every('ToolbarView'), []);
    const [group] = every('GroupView');
    const [host] = childrenNamed(group!, 'RNHostView');
    assert.ok(all([host!]).includes(byId('body')!), 'the content is straight under the group');
    assert.equal(byId('close'), undefined);

    instance.closable.set(true);
    await pass();
    assert.equal(every('NavigationStackView').length, 1, 'and comes back with the item');
    assert.ok(byId('close'));
    assert.ok(byId('body'));
  });

  it('leaves the toolbar out of a build with none, where a SwiftUI view under it would crash', async () => {
    // Expo Go has the `@expo/ui` its SDK shipped with, which is older than the toolbar.
    const warned: unknown[] = [];
    const warn = console.warn;
    console.warn = (message: unknown) => warned.push(message);
    try {
      const { every, byId } = await boot('ios', Sheet, false);
      assert.deepEqual(every('NavigationStackView'), []);
      assert.deepEqual(every('ToolbarView'), []);
      assert.equal(byId('close'), undefined, 'the item is not drawn');
      assert.ok(byId('body'), 'and the sheet still shows its content');
      assert.equal(warned.length, 1);
      assert.match(String(warned[0]), /ui-toolbar-item.*@expo\/ui 57\.0\.20/);
    } finally {
      console.warn = warn;
    }
  });

  it('asks the build whether it has the toolbar, both views of it', async () => {
    const scope = globalThis as { expo?: unknown };
    const before = scope.expo;
    const has = (views: readonly string[]) => ({
      getViewConfig: (module: string, view: string) =>
        module === 'ExpoUI' && views.includes(view) ? {} : null,
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      scope.expo = has(['NavigationStackView', 'ToolbarView']);
      assert.equal((await boot('ios', Sheet, null)).every('ToolbarView').length, 1);
      scope.expo = has(['NavigationStackView']);
      assert.equal((await boot('ios', Sheet, null)).every('ToolbarView').length, 0);
      scope.expo = undefined;
      assert.equal((await boot('ios', Sheet, null)).every('ToolbarView').length, 0, 'no Expo');
    } finally {
      scope.expo = before;
      console.warn = warn;
    }
  });

  it('draws no item on Android, whose sheet has no toolbar, and keeps the content', async () => {
    const { every, byId } = await boot('android', Sheet);
    assert.ok(every('ModalBottomSheetView')[0]);
    assert.ok(byId('body'));
    assert.equal(byId('close'), undefined);
  });
});
