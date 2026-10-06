/**
 * `UiBottomSheet`: one element for SwiftUI's sheet and Compose's, which are driven differently.
 * SwiftUI's stays in the tree and is presented by a prop; Compose's shows for as long as it is in
 * the tree. What is pinned here is what each platform is committed, which is all either reads.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { InjectionToken, Type } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { registerExpoUiViews } from '@ng-native/expo';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Writable<T> {
  (): T;
  set(value: T): void;
}

interface Fixture {
  readonly open: Writable<boolean>;
  readonly fit: Writable<boolean>;
  readonly grabber: Writable<boolean>;
  readonly detents: Writable<readonly unknown[] | undefined>;
  readonly second: Writable<string>;
  dismissed(): number;
  heard(): number;
}

const all = (n: readonly FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...all(x.children)]);

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

let Sheet: Type<Fixture>;
/** The component as the fixture compiled it: the class whose token its sheets inject. */
let UiBottomSheet: { readonly SOURCE: InjectionToken<unknown> };
let Defaults: Type<{ readonly open: Writable<boolean> }>;

before(async () => {
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/expo-ui-bottom-sheet.ts', import.meta.url)),
  );
  Sheet = mod['ExpoUiBottomSheetFixture'] as Type<Fixture>;
  UiBottomSheet = mod['UiBottomSheet'] as typeof UiBottomSheet;
  Defaults = mod['ExpoUiBottomSheetDefaultsFixture'] as typeof Defaults;
});

after(() => {
  registerPlatformComponents('ios');
  registerExpoUiViews('ios');
});

/** What the sheet's `hide` was called on, and the promises it answered with, to settle by hand. */
function fakeHide() {
  const tags: number[] = [];
  const pending: (() => void)[] = [];
  return {
    tags,
    /** Finish the oldest `hide()` still animating. */
    finish: () => pending.shift()!(),
    functions: {
      hide(this: { nativeTag: number }) {
        tags.push(this.nativeTag);
        return new Promise<void>((resolve) => pending.push(resolve));
      },
    },
  };
}

async function boot<T = Fixture>(
  platform: 'ios' | 'android',
  options: { fixture?: Type<T>; functions?: unknown } = {},
) {
  registerPlatformComponents(platform);
  registerExpoUiViews(platform);
  const fabric = createFakeFabric();
  const app = mount(1, (options.fixture ?? Sheet) as Type<T>, fabric, {
    conditions: { width: 390, height: 844, colorScheme: 'light' },
    providers: [
      { provide: UiBottomSheet.SOURCE, useValue: 'functions' in options ? options.functions : {} },
    ],
  });
  await settled();
  const every = (pattern: RegExp) => all(fabric.committed).filter((n) => pattern.test(n.viewName));
  const named = (pattern: RegExp) => every(pattern)[0];
  const byId = (id: string) => all(fabric.committed).find((n) => n.props['testID'] === id);
  const instance = app.componentRef.instance as T;
  const pass = async () => {
    app.applicationRef.tick();
    await settled();
  };
  return { fabric, app, named, every, byId, instance, pass };
}

/** The `$type` of each modifier a node was committed with, against the modifier itself. */
function modifiersOf(node: FakeFabricNode): Record<string, Record<string, unknown>> {
  const modifiers = (node.props['modifiers'] ?? []) as { $type: string }[];
  return Object.fromEntries(modifiers.map((modifier) => [modifier.$type, modifier]));
}

describe('a bottom sheet on iOS, which SwiftUI presents by a prop', () => {
  it('is in the tree while closed, not presented, with its content left out', async () => {
    const { named, byId } = await boot('ios');
    const sheet = named(/ExpoUI_BottomSheetView$/)!;
    assert.equal(sheet.props['isPresented'], false);
    assert.deepEqual(sheet.children, [], 'the content is mounted when it is presented');
    assert.equal(byId('first'), undefined);
  });

  it('is presented when the model opens, and stays in the tree when it closes', async () => {
    const { named, instance, pass } = await boot('ios');
    instance.open.set(true);
    await pass();
    assert.equal(named(/ExpoUI_BottomSheetView$/)!.props['isPresented'], true);

    instance.open.set(false);
    await pass();
    const sheet = named(/ExpoUI_BottomSheetView$/);
    assert.ok(sheet, 'SwiftUI dismisses a sheet it still has');
    assert.equal(sheet.props['isPresented'], false);
  });

  it('wraps the content as @expo/ui does: a host, the sheet, a group and a view host', async () => {
    const { fabric, named, byId, instance, pass } = await boot('ios');
    instance.open.set(true);
    await pass();

    const host = named(/ExpoUI_HostView$/)!;
    assert.equal(host.props['position'], 'absolute', 'so it takes no room where it is written');
    assert.equal(host.props['width'], 390);
    assert.equal(host.props['pointerEvents'], 'none');

    const element = all(fabric.committed).find((n) => n.children.includes(host))!;
    assert.equal(element.viewName, 'View', 'the element is a plain view around the wrapping');
    assert.equal(element.props['position'], 'absolute');

    const sheet = host.children[0]!;
    assert.match(sheet.viewName, /ExpoUI_BottomSheetView$/);
    const group = sheet.children[0]!;
    assert.match(group.viewName, /ExpoUI_GroupView$/);
    const hosted = group.children[0]!;
    assert.match(hosted.viewName, /ExpoUI_RNHostView$/);
    assert.equal(hosted.props['layoutRoot'], true, 'a sheet is a window of its own');
    assert.equal(hosted.children.length, 1, 'a view host holds one element');

    const body = hosted.children[0]!;
    assert.equal(body.viewName, 'View');
    assert.deepEqual(
      body.children.map((child) => [child.viewName, child.props['testID']]),
      [
        ['View', 'first'],
        ['View', 'second'],
      ],
      'the content is the components written inside the element',
    );
    assert.equal(byId('second')!.children[0]!.viewName, 'Paragraph');
    assert.equal(
      all([hosted]).some((n) => 'pointerEvents' in n.props),
      false,
      'the host takes no touch where it is written; the sheet, a window of its own, takes them',
    );
    assert.equal(
      all(fabric.committed).filter((n) => /BottomSheetView$/.test(n.viewName)).length,
      1,
      'the element itself is a plain view, not a second sheet',
    );
  });

  it('keeps the content the app s own: a change inside it is committed', async () => {
    const { fabric, instance, pass } = await boot('ios');
    instance.open.set(true);
    await pass();
    instance.second.set('Deux');
    await pass();
    assert.ok(all(fabric.committed).some((n) => n.props['text'] === 'Deux'));
  });

  it('takes a native dismissal back into the model', async () => {
    const { fabric, app, named, instance } = await boot('ios');
    instance.open.set(true);
    app.applicationRef.tick();
    await settled();

    fabric.emit(named(/ExpoUI_BottomSheetView$/)!, 'topIsPresentedChange', { isPresented: false });
    app.applicationRef.tick();
    await settled();

    assert.equal(instance.open(), false);
    assert.equal(named(/ExpoUI_BottomSheetView$/)!.props['isPresented'], false);
  });

  it('keeps the content until SwiftUI has dismissed it, then says so once', async () => {
    const { fabric, named, byId, instance, pass } = await boot('ios');
    instance.open.set(true);
    await pass();
    fabric.emit(named(/ExpoUI_BottomSheetView$/)!, 'topIsPresentedChange', { isPresented: false });
    await pass();
    assert.ok(byId('first'), 'the sheet is still sliding away, with its content in it');
    assert.equal(instance.dismissed(), 0);

    fabric.emit(named(/ExpoUI_BottomSheetView$/)!, 'topDismiss', {});
    await pass();
    assert.equal(byId('first'), undefined);
    assert.equal(instance.dismissed(), 1);
    assert.ok(named(/ExpoUI_BottomSheetView$/), 'the sheet itself stays');
  });

  it('takes a swipe as SwiftUI reports one: dismissed first, then no longer presented', async () => {
    const { fabric, named, byId, instance, pass } = await boot('ios');
    instance.open.set(true);
    await pass();

    fabric.emit(named(/ExpoUI_BottomSheetView$/)!, 'topDismiss', {});
    fabric.emit(named(/ExpoUI_BottomSheetView$/)!, 'topIsPresentedChange', { isPresented: false });
    await pass();
    assert.equal(instance.open(), false);
    assert.equal(byId('first'), undefined, 'the sheet has gone, and its content with it');
    assert.equal(instance.dismissed(), 1);
    assert.equal(named(/ExpoUI_BottomSheetView$/)!.props['isPresented'], false);

    instance.open.set(true);
    await pass();
    assert.ok(byId('first'), 'and it opens again');
  });

  it('says it was dismissed when the model closed it too', async () => {
    const { fabric, named, byId, instance, pass } = await boot('ios');
    instance.open.set(true);
    await pass();
    instance.open.set(false);
    await pass();
    assert.ok(byId('first'));

    fabric.emit(named(/ExpoUI_BottomSheetView$/)!, 'topDismiss', {});
    await pass();
    assert.equal(byId('first'), undefined);
    assert.equal(instance.dismissed(), 1);
  });

  it('opens again after a dismissal, with its content back', async () => {
    const { fabric, named, byId, instance, pass } = await boot('ios');
    instance.open.set(true);
    await pass();
    instance.open.set(false);
    await pass();
    fabric.emit(named(/ExpoUI_BottomSheetView$/)!, 'topDismiss', {});
    await pass();

    instance.open.set(true);
    await pass();
    assert.equal(named(/ExpoUI_BottomSheetView$/)!.props['isPresented'], true);
    assert.ok(byId('first'));
    assert.ok(byId('second'));
  });

  it('keeps the content of a sheet opened again before SwiftUI finished dismissing it', async () => {
    const { fabric, named, byId, instance, pass } = await boot('ios');
    instance.open.set(true);
    await pass();
    instance.open.set(false);
    await pass();
    instance.open.set(true);
    await pass();

    fabric.emit(named(/ExpoUI_BottomSheetView$/)!, 'topDismiss', {});
    await pass();
    assert.ok(byId('first'), 'it is presented again, so it keeps what it presents');
    assert.equal(instance.dismissed(), 0);
  });

  it('rests at half and full height, or at the height of its content', async () => {
    const { fabric, named, instance, pass } = await boot('ios');
    instance.open.set(true);
    await pass();

    assert.equal(named(/ExpoUI_BottomSheetView$/)!.props['fitToContents'], false);
    assert.deepEqual(modifiersOf(named(/ExpoUI_GroupView$/)!)['presentationDetents'], {
      $type: 'presentationDetents',
      detents: ['medium', 'large'],
    });
    const filling = named(/ExpoUI_RNHostView$/)!;
    assert.ok(!filling.props['matchContents'], 'it fills the height SwiftUI gives it');
    assert.ok(!filling.props['expoInternalSizeFromChildren']);
    assert.equal(filling.children[0]!.props['flexGrow'], 1);
    assert.equal(filling.children[0]!.props['height'], 0);

    instance.fit.set(true);
    await pass();
    assert.equal(
      named(/ExpoUI_BottomSheetView$/)!.props['fitToContents'],
      false,
      'a view host takes its sizing as it mounts, so the sheet on screen keeps its own',
    );
    assert.ok(!named(/ExpoUI_RNHostView$/)!.props['matchContents']);

    instance.open.set(false);
    await pass();
    fabric.emit(named(/ExpoUI_BottomSheetView$/)!, 'topDismiss', {});
    await pass();
    instance.open.set(true);
    await pass();
    assert.equal(named(/ExpoUI_BottomSheetView$/)!.props['fitToContents'], true);
    const modifiers = modifiersOf(named(/ExpoUI_GroupView$/)!);
    assert.equal('presentationDetents' in modifiers, false, 'SwiftUI s sheet measures the detent');
    assert.equal(modifiers['presentationSizing']?.['sizing'], 'fitted', 'for an iPad');
    const fitted = named(/ExpoUI_RNHostView$/)!;
    assert.equal(fitted.props['matchContents'], true);
    assert.equal(fitted.props['expoInternalSizeFromChildren'], true);
    assert.equal(fitted.children[0]!.props['width'], 390, 'as wide as the window');
    assert.ok(!fitted.children[0]!.props['flexGrow']);
  });

  it('follows the window when it turns', async () => {
    const { app, named, instance, pass } = await boot('ios', { fixture: Defaults });
    assert.equal(instance.open(), true);
    app.engine.updateConditions({ width: 844, height: 390, colorScheme: 'light' });
    await pass();
    assert.equal(named(/ExpoUI_HostView$/)!.props['width'], 844);
    assert.equal(named(/ExpoUI_RNHostView$/)!.children[0]!.props['width'], 844);
  });

  it('leaves an event from its content alone, and keeps its own from a listener around it', async () => {
    const { fabric, named, byId, instance, pass } = await boot('ios');
    instance.open.set(true);
    await pass();

    // As a modal in the content sends when it closes.
    fabric.emit(byId('first')!, 'topDismiss', {});
    fabric.emit(byId('first')!, 'topIsPresentedChange', { isPresented: false });
    await pass();
    assert.equal(instance.open(), true);
    assert.ok(byId('first'), 'the sheet was not dismissed');
    assert.equal(instance.heard(), 2, 'and the event went on its way');

    fabric.emit(named(/ExpoUI_BottomSheetView$/)!, 'topIsPresentedChange', { isPresented: false });
    fabric.emit(named(/ExpoUI_BottomSheetView$/)!, 'topDismiss', {});
    await pass();
    assert.equal(instance.open(), false);
    assert.equal(instance.heard(), 2, 'the sheet s own events are not the app s to hear');
  });

  const detentsOf = (group: FakeFabricNode) =>
    modifiersOf(group)['presentationDetents']?.['detents'];

  for (const detents of [
    ['medium'],
    [{ fraction: 0.4 }, 'large'],
    [{ height: 320 }, { fraction: 0.8 }],
  ] as const) {
    it(`rests at the detents it is given: ${JSON.stringify(detents)}`, async () => {
      const { named, instance, pass } = await boot('ios');
      instance.detents.set(detents);
      instance.open.set(true);
      await pass();
      assert.deepEqual(modifiersOf(named(/ExpoUI_GroupView$/)!)['presentationDetents'], {
        $type: 'presentationDetents',
        detents,
      });
      assert.equal(named(/ExpoUI_BottomSheetView$/)!.props['fitToContents'], false);
      const hosted = named(/ExpoUI_RNHostView$/)!;
      assert.ok(!hosted.props['matchContents'], 'the content fills the detent');
      assert.equal(hosted.children[0]!.props['flexGrow'], 1);
    });
  }

  it('rests at its detents rather than fitting its content, where it is given both', async () => {
    const { named, instance, pass } = await boot('ios');
    instance.fit.set(true);
    instance.detents.set(['medium']);
    instance.open.set(true);
    await pass();
    const modifiers = modifiersOf(named(/ExpoUI_GroupView$/)!);
    assert.deepEqual(modifiers['presentationDetents']?.['detents'], ['medium']);
    assert.equal('presentationSizing' in modifiers, false);
    assert.equal(named(/ExpoUI_BottomSheetView$/)!.props['fitToContents'], false);
    assert.ok(!named(/ExpoUI_RNHostView$/)!.props['matchContents']);
  });

  it('follows its detents while it is open, back to half and full when they go', async () => {
    const { named, instance, pass } = await boot('ios');
    instance.detents.set(['medium']);
    instance.open.set(true);
    await pass();
    const host = named(/ExpoUI_RNHostView$/)!.reactTag;

    instance.detents.set([{ fraction: 0.3 }, 'large']);
    await pass();
    assert.deepEqual(detentsOf(named(/ExpoUI_GroupView$/)!), [{ fraction: 0.3 }, 'large']);
    assert.equal(named(/ExpoUI_RNHostView$/)!.reactTag, host, 'the content stays as it is');

    instance.detents.set(undefined);
    await pass();
    assert.deepEqual(detentsOf(named(/ExpoUI_GroupView$/)!), ['medium', 'large']);

    instance.detents.set(['large']);
    await pass();
    assert.deepEqual(detentsOf(named(/ExpoUI_GroupView$/)!), ['large']);

    instance.detents.set([]);
    await pass();
    assert.deepEqual(detentsOf(named(/ExpoUI_GroupView$/)!), ['medium', 'large'], 'none is unset');
  });

  it('decides between its content and its detents as it opens, not while open', async () => {
    const { fabric, named, instance, pass } = await boot('ios');
    const reopen = async () => {
      instance.open.set(false);
      await pass();
      fabric.emit(named(/ExpoUI_BottomSheetView$/)!, 'topDismiss', {});
      await pass();
      instance.open.set(true);
      await pass();
    };
    instance.fit.set(true);
    instance.open.set(true);
    await pass();

    instance.detents.set(['medium']);
    await pass();
    assert.equal(named(/ExpoUI_BottomSheetView$/)!.props['fitToContents'], true);
    assert.equal(detentsOf(named(/ExpoUI_GroupView$/)!), undefined, 'still sized to its content');
    assert.equal(named(/ExpoUI_RNHostView$/)!.props['matchContents'], true);

    await reopen();
    assert.equal(named(/ExpoUI_BottomSheetView$/)!.props['fitToContents'], false);
    assert.deepEqual(detentsOf(named(/ExpoUI_GroupView$/)!), ['medium']);

    instance.detents.set(undefined);
    await pass();
    assert.equal(named(/ExpoUI_BottomSheetView$/)!.props['fitToContents'], false);
    assert.deepEqual(detentsOf(named(/ExpoUI_GroupView$/)!), ['medium', 'large']);

    await reopen();
    assert.equal(named(/ExpoUI_BottomSheetView$/)!.props['fitToContents'], true, 'fitted again');
    assert.equal(detentsOf(named(/ExpoUI_GroupView$/)!), undefined);
  });

  it('shows the grabber unless told not to', async () => {
    const { named, instance, pass } = await boot('ios');
    instance.open.set(true);
    await pass();
    const indicator = () => modifiersOf(named(/ExpoUI_GroupView$/)!)['presentationDragIndicator'];
    assert.deepEqual(indicator(), { $type: 'presentationDragIndicator', visibility: 'visible' });

    instance.grabber.set(false);
    await pass();
    assert.deepEqual(indicator(), { $type: 'presentationDragIndicator', visibility: 'hidden' });
  });

  it('sends SwiftUI none of Compose s props', async () => {
    const { named, instance, pass } = await boot('ios');
    instance.open.set(true);
    await pass();
    const sheet = named(/ExpoUI_BottomSheetView$/)!;
    assert.equal('showDragHandle' in sheet.props, false);
    assert.equal('skipPartiallyExpanded' in sheet.props, false);
  });
});

describe('a bottom sheet on Android, which Compose shows while it is in the tree', () => {
  it('is not in the tree while closed', async () => {
    const { every, byId } = await boot('android');
    assert.deepEqual(every(/ExpoUI_/), []);
    assert.equal(byId('first'), undefined);
  });

  it('is in the tree while open, wrapped as @expo/ui wraps it, with no SwiftUI group', async () => {
    const { named, every, instance, pass } = await boot('android');
    instance.open.set(true);
    await pass();

    const host = named(/ExpoUI_HostView$/)!;
    assert.equal(host.props['position'], 'absolute');
    assert.equal(host.props['pointerEvents'], 'none');
    const sheet = host.children[0]!;
    assert.match(sheet.viewName, /ExpoUI_ModalBottomSheetView$/);
    assert.equal('isPresented' in sheet.props, false, 'Compose has no such prop');
    assert.equal('fitToContents' in sheet.props, false);
    assert.deepEqual(every(/GroupView$/), []);

    const hosted = sheet.children[0]!;
    assert.match(hosted.viewName, /ExpoUI_RNHostView$/);
    assert.equal(hosted.props['layoutRoot'], true);
    assert.equal(hosted.children.length, 1);
    assert.deepEqual(
      hosted.children[0]!.children.map((child) => child.props['testID']),
      ['first', 'second'],
    );
  });

  it('leaves the tree when the model closes it, and says it was dismissed', async () => {
    const { every, instance, pass } = await boot('android');
    instance.open.set(true);
    await pass();
    instance.open.set(false);
    await pass();
    await pass();
    assert.deepEqual(every(/ExpoUI_/), []);
    assert.equal(instance.dismissed(), 1);
  });

  it('takes a native dismissal back into the model, and leaves the tree', async () => {
    const { fabric, named, every, instance, pass } = await boot('android');
    instance.open.set(true);
    await pass();

    fabric.emit(named(/ExpoUI_ModalBottomSheetView$/)!, 'topDismissRequest', {});
    await pass();
    await pass();
    assert.equal(instance.open(), false);
    assert.deepEqual(every(/ExpoUI_/), []);
    assert.equal(instance.dismissed(), 1);
  });

  it('leaves an event from its content alone, and keeps its own from a listener around it', async () => {
    const { fabric, named, byId, instance, pass } = await boot('android');
    instance.open.set(true);
    await pass();

    fabric.emit(byId('first')!, 'topDismissRequest', {});
    await pass();
    assert.equal(instance.open(), true);
    assert.equal(instance.heard(), 1);

    fabric.emit(named(/ExpoUI_ModalBottomSheetView$/)!, 'topDismissRequest', {});
    await pass();
    assert.equal(instance.open(), false);
    assert.equal(instance.heard(), 1);
  });

  it('opens again after a dismissal, with its content back', async () => {
    const { fabric, named, byId, instance, pass } = await boot('android');
    instance.open.set(true);
    await pass();
    fabric.emit(named(/ExpoUI_ModalBottomSheetView$/)!, 'topDismissRequest', {});
    await pass();
    await pass();

    instance.open.set(true);
    await pass();
    assert.ok(named(/ExpoUI_ModalBottomSheetView$/));
    assert.ok(byId('first'));
    assert.ok(byId('second'));
  });

  it('slides a sheet the model closed away before taking it out of the tree', async () => {
    const hide = fakeHide();
    const { named, instance, pass } = await boot('android', { functions: hide.functions });
    instance.open.set(true);
    await pass();
    const tag = named(/ExpoUI_ModalBottomSheetView$/)!.reactTag;

    instance.open.set(false);
    await pass();
    assert.deepEqual(hide.tags, [tag], 'the sheet on screen is the one asked to hide');
    assert.ok(named(/ExpoUI_ModalBottomSheetView$/), 'in the tree while it slides away');
    assert.equal(instance.dismissed(), 0);

    hide.finish();
    await pass();
    await pass();
    assert.equal(named(/ExpoUI_ModalBottomSheetView$/), undefined);
    assert.equal(instance.dismissed(), 1);
  });

  it('shows a sheet opened again while it was sliding away', async () => {
    const hide = fakeHide();
    const { named, byId, instance, pass } = await boot('android', { functions: hide.functions });
    instance.open.set(true);
    await pass();
    const hidden = named(/ExpoUI_ModalBottomSheetView$/)!.reactTag;
    instance.open.set(false);
    await pass();
    instance.open.set(true);
    await pass();

    hide.finish();
    await pass();
    await pass();
    await pass();
    const shown = named(/ExpoUI_ModalBottomSheetView$/);
    assert.ok(shown, 'the model says open');
    assert.notEqual(shown.reactTag, hidden, 'a new sheet: Compose hid the one it was asked to');
    assert.ok(byId('first'));
    assert.equal(instance.dismissed(), 0, 'it never closed, as far as the app can tell');
  });

  it('leaves the tree when hiding fails, rather than staying on screen', async () => {
    const functions = { hide: () => Promise.reject(new Error('no such view')) };
    const { every, instance, pass } = await boot('android', { functions });
    instance.open.set(true);
    await pass();
    instance.open.set(false);
    await pass();
    await pass();
    assert.deepEqual(every(/ExpoUI_/), []);
    assert.equal(instance.dismissed(), 1);
  });

  for (const [what, functions] of [
    ['has no hide, as an older @expo/ui has none', {}],
    [
      'throws from hide',
      {
        hide: () => {
          throw new Error('no view with that tag');
        },
      },
    ],
  ] as const) {
    it(`leaves the tree at once where the module ${what}`, async () => {
      const { every, instance, pass } = await boot('android', { functions });
      instance.open.set(true);
      await pass();
      instance.open.set(false);
      await pass();
      assert.deepEqual(every(/ExpoUI_/), []);
      assert.equal(instance.dismissed(), 1);
    });
  }

  it('opens at half height and drags to full, or opens at the height of its content', async () => {
    const { named, instance, pass } = await boot('android');
    instance.open.set(true);
    await pass();
    assert.equal(named(/ExpoUI_ModalBottomSheetView$/)!.props['skipPartiallyExpanded'], false);
    const filling = named(/ExpoUI_RNHostView$/)!;
    assert.ok(!filling.props['matchContents']);
    assert.equal(filling.children[0]!.props['flexGrow'], 1);
    assert.equal(filling.children[0]!.props['height'], 0);

    instance.open.set(false);
    await pass();
    await pass();
    instance.fit.set(true);
    instance.open.set(true);
    await pass();
    assert.equal(named(/ExpoUI_ModalBottomSheetView$/)!.props['skipPartiallyExpanded'], true);
    const fitted = named(/ExpoUI_RNHostView$/)!;
    assert.equal(fitted.props['matchContents'], true);
    assert.equal(fitted.props['expoInternalSizeFromChildren'], true);
    assert.equal(fitted.children[0]!.props['width'], 390);
  });

  for (const fit of [false, true]) {
    it(`takes detents and commits nothing for them, ${fit ? 'fitted' : 'at half height'}`, async () => {
      const committed = async (detents: readonly unknown[] | undefined) => {
        const { named, every, instance, pass } = await boot('android');
        instance.fit.set(fit);
        instance.detents.set(detents);
        instance.open.set(true);
        await pass();
        const sheet = () => {
          const hosted = named(/ExpoUI_RNHostView$/)!;
          return [
            named(/ExpoUI_HostView$/)!.props,
            named(/ExpoUI_ModalBottomSheetView$/)!.props,
            hosted.props,
            hosted.children[0]!.props,
            every(/ExpoUI_/).map((n) => n.viewName.replace(/^.*ExpoUI_/, '')),
          ];
        };
        return { sheet, instance, pass };
      };
      const without = await committed(undefined);
      const withDetents = await committed(['large', { fraction: 0.4 }]);
      assert.deepEqual(withDetents.sheet(), without.sheet());
      assert.equal(JSON.stringify(withDetents.sheet()).includes('etent'), false);

      const before = JSON.stringify(withDetents.sheet());
      withDetents.instance.detents.set(['medium']);
      await withDetents.pass();
      withDetents.instance.detents.set(undefined);
      await withDetents.pass();
      assert.equal(JSON.stringify(withDetents.sheet()), before, 'nor for a change while open');
    });
  }

  it('shows the drag handle unless told not to, under Compose s name for it', async () => {
    const { named, instance, pass } = await boot('android');
    instance.open.set(true);
    await pass();
    assert.equal(named(/ExpoUI_ModalBottomSheetView$/)!.props['showDragHandle'], true);
    assert.equal('modifiers' in named(/ExpoUI_ModalBottomSheetView$/)!.props, false);

    instance.grabber.set(false);
    await pass();
    assert.equal(named(/ExpoUI_ModalBottomSheetView$/)!.props['showDragHandle'], false);
  });
});

describe('a bottom sheet with its options left alone', () => {
  for (const platform of ['ios', 'android'] as const) {
    it(`opens from the first pass, with a grabber, on ${platform}`, async () => {
      const { named, instance } = await boot(platform, { fixture: Defaults });
      assert.equal(instance.open(), true);
      const sheet = named(/BottomSheetView$/)!;
      if (platform === 'ios') {
        assert.equal(sheet.props['isPresented'], true);
        assert.equal(sheet.props['fitToContents'], true, 'a bare attribute turns it on');
        assert.equal(
          modifiersOf(named(/ExpoUI_GroupView$/)!)['presentationDragIndicator']?.['visibility'],
          'visible',
        );
      } else {
        assert.equal(sheet.props['skipPartiallyExpanded'], true);
        assert.equal(sheet.props['showDragHandle'], true);
      }
      assert.equal(named(/ExpoUI_RNHostView$/)!.children[0]!.children.length, 1);
    });
  }
});

describe('a bottom sheet where @expo/ui is not installed', () => {
  it('closes on iOS without the dismissal no view is there to report', async () => {
    const { byId, instance, pass } = await boot('ios', { functions: null });
    instance.open.set(true);
    await pass();
    instance.open.set(false);
    await pass();
    await pass();
    assert.equal(byId('first'), undefined, 'the content does not stay in the tree');
    assert.equal(instance.dismissed(), 1);
  });

  it('has no way to hide a sheet to look for, and closes without one', async () => {
    registerPlatformComponents('android');
    registerExpoUiViews('android');
    const fabric = createFakeFabric();
    // No provider: the default source, which finds no native module in Node.
    const app = mount(1, Sheet, fabric);
    const instance = app.componentRef.instance as Fixture;
    instance.open.set(true);
    app.applicationRef.tick();
    await settled();
    instance.open.set(false);
    app.applicationRef.tick();
    await settled();
    app.applicationRef.tick();
    await settled();
    assert.deepEqual(
      all(fabric.committed).filter((n) => /ExpoUI_/.test(n.viewName)),
      [],
    );
    assert.equal(instance.dismissed(), 1);
  });
});
