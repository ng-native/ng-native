/**
 * A stack page's content below an opaque header on iOS 26 and later.
 *
 * There react-native-screens lays every screen out under the navigation bar, opaque or not
 * (from 4.30, `+[RNSScreenStackHeaderConfig screensExtendUnderOpaqueNavigationBar]`), and insets
 * the content with the `SafeAreaView` its `ScreenStackItem` wraps it in: the top edge while the
 * header is shown and not translucent, none otherwise, and the view there either way so that a
 * change does not make the content again. A page whose content commits straight into the screen
 * starts behind the bar.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type, WritableSignal } from '@angular/core';
import type { Routes } from '@angular/router';
import { OS_VERSION } from '@ng-native/device';
import { registerPlatformComponents, type Engine, type EngineNode } from '@ng-native/fabric';
import { cleanup, render, screen, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture, compileSource } from './compile.ts';

type Header = { hidden?: boolean; translucent?: boolean; largeTitle?: boolean; absent?: boolean };

const NONE = { top: false, right: false, bottom: false, left: false };
const TOP = { ...NONE, top: true };

/** A committed view as its name, its props and its children, for comparing a whole tree. */
type Shape = [string, Record<string, unknown>, Shape[]];
const shape = (node: FakeFabricNode): Shape => [
  node.viewName,
  node.props,
  node.children.map(shape),
];

/** What a page's `:host` style lays out its children by, as committed. */
const LAYOUT = {
  flexDirection: 'row',
  justifyContent: 'center',
  alignItems: 'center',
  rowGap: 12,
  columnGap: 12,
};
const LAID_OUT = Object.keys(LAYOUT);

/** The props of `props` that lay out a view's children. */
const layoutOf = (props: Record<string, unknown>) =>
  Object.fromEntries(LAID_OUT.filter((key) => key in props).map((key) => [key, props[key]]));

describe('a stack page under its header', () => {
  let mod: Record<string, unknown>;
  const header = () => mod['header'] as WritableSignal<Header>;
  const later = () => mod['later'] as WritableSignal<boolean>;
  const between = () => mod['between'] as WritableSignal<boolean>;

  before(async () => {
    registerScreenComponents();
    mod = await compileFixture('fixtures/screen-content-inset.ts');
  });

  afterEach(() => {
    cleanup();
    registerPlatformComponents('ios');
    registerScreenComponents();
    header().set({});
    later().set(false);
    between().set(false);
  });

  /** The page on a platform and OS version, with its header bound as given. */
  const open = async (
    platform: string,
    version: number,
    bound: Header = {},
    page = 'OpeningHours',
  ) => {
    registerPlatformComponents(platform);
    registerScreenComponents();
    header().set(bound);
    const routes: Routes = [
      { path: '', component: mod[page] as Type<unknown> },
      { path: 'centred', component: mod['Centred'] as Type<unknown> },
    ];
    const app = await render(mod['OpeningHoursStack'] as Type<unknown>, {
      providers: [provideNativeRouter(routes), { provide: OS_VERSION, useValue: version }],
    });
    await app.detectChanges();
    return app;
  };

  /** The view the page's root content commits into. */
  const holder = (): FakeFabricNode => screen.getByText('Monday to Friday').parent!;

  it('commits the content in a safe area view that insets the top, on iOS 26', async () => {
    await open('ios', 26);
    const content = holder();
    assert.equal(content.viewName, 'RNSSafeAreaView');
    assert.equal(content.parent?.viewName, 'RNSScreen');
    assert.deepEqual(content.props['edges'], TOP);
  });

  it('fills the screen with it, as react-native-screens styles its own', async () => {
    await open('ios', 26);
    assert.equal(holder().props['flex'], 1);
  });

  it('keeps the header a child of the screen, after the content', async () => {
    await open('ios', 26);
    const children = holder().parent!.children.map((child) => child.viewName);
    assert.deepEqual(children, ['RNSSafeAreaView', 'RNSScreenStackHeaderConfig']);
  });

  it('puts content the page shows later in it too', async () => {
    const app = await open('ios', 26);
    later().set(true);
    await app.detectChanges();
    assert.equal(screen.getByText('Closed on holidays').parent, holder());
    assert.equal(holder().children.length, 3);
  });

  it('insets nothing under a hidden, translucent, large-title or absent header', async () => {
    for (const bound of [
      { hidden: true },
      { translucent: true },
      { largeTitle: true },
      { absent: true },
    ]) {
      await open('ios', 26, bound);
      assert.equal(holder().viewName, 'RNSSafeAreaView', JSON.stringify(bound));
      assert.deepEqual(holder().props['edges'], NONE, JSON.stringify(bound));
      cleanup();
    }
  });

  it('follows the header as it changes, without making the content again', async () => {
    const app = await open('ios', 26);
    const tag = screen.getByText('Monday to Friday').reactTag;
    header().set({ translucent: true });
    await app.detectChanges();
    assert.deepEqual(holder().props['edges'], NONE);
    header().set({});
    await app.detectChanges();
    assert.deepEqual(holder().props['edges'], TOP);
    assert.equal(screen.getByText('Monday to Friday').reactTag, tag);
  });

  it('leaves the top to it in a page that insets its own, so the bar is not counted twice', async () => {
    await open('ios', 26);
    const own = screen.getByTestId('own').props['edges'] as Record<string, boolean>;
    assert.deepEqual({ top: own['top'], bottom: own['bottom'] }, { top: false, bottom: true });
  });

  it('commits the content straight into the screen before iOS 26, as it did', async () => {
    await open('ios', 18);
    assert.equal(holder().viewName, 'RNSScreen');
    const own = screen.getByTestId('own').props['edges'] as Record<string, boolean>;
    assert.equal(own['top'], true);
  });

  it('commits the content in a safe area view on macOS, under the title bar and toolbar', async () => {
    // macOS 15: any version, since every Mac window puts its content under its title bar.
    await open('macos', 15);
    const content = holder();
    assert.equal(content.viewName, 'RNSSafeAreaView');
    assert.equal(content.parent?.viewName, 'RNSScreen');
    assert.deepEqual(content.props['edges'], TOP);
  });

  it('commits the content straight into the screen on Android', async () => {
    await open('android', 36);
    assert.equal(holder().viewName, 'RNSScreen');
  });

  it('commits the same native tree on iOS 26 as a view of the page would', async () => {
    const app = await open('ios', 26);
    const stack = app.fabric.committed[0]!.children[0]!;
    const text = (words: string, more: Record<string, unknown>): Shape => [
      'Paragraph',
      { ellipsizeMode: 'tail', accessible: true, ...more },
      [['RawText', { text: words }, []]],
    ];
    assert.deepEqual(shape(stack.children[0]!), [
      'RNSScreen',
      {
        activityState: 2,
        nativeBackButtonDismissalEnabled: false,
        gestureResponseDistance: { start: -1, end: -1, top: -1, bottom: -1 },
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      },
      [
        [
          'RNSSafeAreaView',
          { flex: 1, edges: TOP },
          [
            text('Monday to Friday', {}),
            [
              'RNSSafeAreaView',
              { flex: 1, nativeID: 'own', edges: { ...NONE, bottom: true } },
              [text('Weekends', { ellipsizeMode: 'clip', numberOfLines: 1 })],
            ],
          ],
        ],
        [
          'RNSScreenStackHeaderConfig',
          {
            position: 'absolute',
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            title: 'Opening hours',
            titleColor: 'rgb(10, 10, 10)',
            backgroundColor: 'rgb(255, 255, 255)',
            color: 'rgb(10, 10, 10)',
            consumeTopInset: false,
          },
          [],
        ],
      ],
    ]);
  });

  /** The view the centred page's root elements are committed in, and the screen it is in. */
  const centred = (words = 'First') => {
    const holder = screen.getByText(words).parent!.parent!;
    return { holder, screen: holder.parent! };
  };

  it("lays out the page's own elements by its :host style on iOS 26", async () => {
    await open('ios', 26, {}, 'Centred');
    const { holder, screen: page } = centred();
    assert.equal(holder.viewName, 'RNSSafeAreaView');
    assert.equal(page.viewName, 'RNSScreen');
    assert.deepEqual(layoutOf(holder.props), LAYOUT, 'the view the elements are in lays them out');
    assert.deepEqual(layoutOf(page.props), {}, 'and the screen leaves the view to fill it');
    assert.equal(holder.props['flex'], 1);
    assert.equal(page.props['backgroundColor'], 'rgb(1, 2, 3)', 'the rest stays on the screen');
    assert.equal(holder.props['backgroundColor'], undefined);
  });

  it("matches a :host > rule against the page's own elements on iOS 26", async () => {
    await open('ios', 26, {}, 'Centred');
    const cells = centred().holder.children;
    assert.deepEqual(
      cells.map((cell) => cell.props['opacity']),
      [0.5, 0.5],
    );
  });

  it('lays out and matches on the screen itself before iOS 26 and on Android, as it did', async () => {
    for (const [platform, version] of [
      ['ios', 18],
      ['android', 36],
    ] as const) {
      await open(platform, version, {}, 'Centred');
      const holder = screen.getByText('First').parent!.parent!;
      assert.equal(holder.viewName, 'RNSScreen', platform);
      assert.deepEqual(layoutOf(holder.props), LAYOUT, platform);
      assert.equal(holder.children[0]!.props['opacity'], 0.5, platform);
      cleanup();
    }
  });

  it('puts an element the page shows between two others in its place, laid out', async () => {
    const app = await open('ios', 26, {}, 'Centred');
    between().set(true);
    await app.detectChanges();
    const { holder, screen: page } = centred();
    const words = holder.children.map((cell) => cell.children[0]!.children[0]!.props['text']);
    assert.deepEqual(words, ['First', 'Between', 'Last']);
    assert.deepEqual(
      holder.children.map((cell) => cell.props['opacity']),
      [0.5, 0.5, 0.5],
    );
    assert.deepEqual(
      page.children.map((child) => child.viewName),
      ['RNSSafeAreaView', 'RNSScreenStackHeaderConfig'],
    );
    between().set(false);
    await app.detectChanges();
    assert.equal(centred().holder.children.length, 2);
  });

  /** The engine and the page's screen node, for driving the engine directly. */
  const engineOf = () => {
    const node = centred().screen.instanceHandle as EngineNode;
    return { engine: node.engine as Engine, node };
  };
  const wordsIn = (holder: FakeFabricNode) =>
    holder.children.map((cell) => cell.children[0]?.children[0]?.props['text']);

  it('takes elements inserted, moved and removed through the engine into the view', async () => {
    const app = await open('ios', 26, {}, 'Centred');
    const { engine, node } = engineOf();
    const [first, last] = node.childList.filter((child) => child.classes?.has('cell'));
    const made = engine.createElement('text');
    engine.appendChild(made, engine.createText('Made'));
    engine.insertBefore(node, made, first!);
    await app.detectChanges();
    assert.deepEqual(wordsIn(centred().holder), [undefined, 'First', 'Last']);
    assert.equal(screen.getByText('Made').parent, centred().holder, 'inserted before the first');

    engine.insertBefore(node, last!, first!);
    await app.detectChanges();
    assert.deepEqual(wordsIn(centred().holder).slice(1), ['Last', 'First'], 'moved');

    engine.removeChild(node, first!);
    engine.removeChild(node, made);
    await app.detectChanges();
    assert.deepEqual(wordsIn(centred('Last').holder), ['Last'], 'removed with the screen named');
    assert.equal(screen.queryByText('First'), null);
    assert.deepEqual(
      centred('Last').screen.children.map((child) => child.viewName),
      ['RNSSafeAreaView', 'RNSScreenStackHeaderConfig'],
    );
  });

  it('takes the view away with the page, and makes a new one for the next', async () => {
    const app = await open('ios', 26);
    const navigation = app.componentRef.injector.get(NativeNavigation);
    const turns = async () => {
      for (let turn = 0; turn < 6; turn++) await settle();
    };
    await navigation.push('/centred');
    await turns();
    const first = centred().holder.reactTag;
    assert.deepEqual(layoutOf(centred().holder.props), LAYOUT);
    assert.equal(holder().viewName, 'RNSSafeAreaView', 'the page below keeps its own');

    navigation.back();
    await turns();
    assert.equal(screen.queryByText('First'), null);
    const stack = app.fabric.committed[0]!.children[0]!;
    assert.equal(stack.children.length, 1);
    assert.deepEqual(
      stack.children[0]!.children.map((child) => child.viewName),
      ['RNSSafeAreaView', 'RNSScreenStackHeaderConfig'],
    );

    await navigation.push('/centred');
    await turns();
    assert.notEqual(centred().holder.reactTag, first, 'a new page, in a new view');
    assert.deepEqual(layoutOf(centred().holder.props), LAYOUT);
  });

  it('creates the screen and its content once, with the view, from the first commit', async () => {
    const before = (await open('ios', 18)).fabric.calls.createNode;
    cleanup();
    const after = (await open('ios', 26)).fabric.calls.createNode;
    assert.equal(after, before + 1, 'one view more, and nothing made twice');
  });

  it('keeps the view the header leaves behind beside the content, when the header goes', async () => {
    const app = await open('ios', 26);
    header().set({ absent: true });
    await app.detectChanges();
    const page = holder().parent!;
    assert.deepEqual(
      page.children.map((child) => child.viewName),
      ['RNSSafeAreaView', 'RNSScreenStackHeaderConfig'],
    );
    assert.equal(page.children[1]!.props['hidden'], true);
    assert.equal(
      holder().children.some((child) => child.viewName === 'RNSScreenStackHeaderConfig'),
      false,
    );
  });

  it('keeps the view a screen was made with for as long as it lives', async () => {
    const app = await open('ios', 26);
    const tag = holder().reactTag;
    // What platform the engine is told of later changes nothing for a screen already made.
    registerPlatformComponents('android');
    registerScreenComponents();
    header().set({ translucent: true });
    await app.detectChanges();
    assert.equal(holder().reactTag, tag);
    assert.deepEqual(holder().props['edges'], NONE);
  });
});

describe('a stack page under its header, edited while it runs', () => {
  afterEach(() => {
    cleanup();
    registerPlatformComponents('ios');
    registerScreenComponents();
  });

  const page = (justify: string, words: string) => `import { Component } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

@Component({
  selector: 'x-hot-page',
  imports: [NativeHeader, Text],
  template: '<native-header title="Hot" /><text>${words}</text>',
  styles: ':host { justify-content: ${justify}; }',
})
export class HotPage {}

@Component({
  selector: 'x-hot-stack',
  imports: [NativeStackOutlet],
  template: '<native-stack-outlet />',
})
export class HotStack {}
`;
  const at = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

  it("keeps the view and lays out what a hot swap puts in it by the page's new :host", async () => {
    registerPlatformComponents('ios');
    registerScreenComponents();
    const file = at('hot-stack-page.ts');
    const before = await compileSource(
      page('center', 'Before'),
      file,
      at('hot-stack-page.hmr-a.generated.ts'),
      { dev: true },
    );
    const app = await render(before['HotStack'] as Type<unknown>, {
      providers: [
        provideNativeRouter([{ path: '', component: before['HotPage'] as Type<unknown> }]),
        { provide: OS_VERSION, useValue: 26 },
      ],
    });
    await app.detectChanges();
    const wrapper = () => screen.getByText(/^(Before|After)$/).parent!;
    const tag = wrapper().reactTag;
    assert.equal(wrapper().props['justifyContent'], 'center');

    await compileSource(page('flex-end', 'After'), file, at('hot-stack-page.hmr-b.generated.ts'), {
      dev: true,
    });
    for (let turn = 0; turn < 3; turn++) await settle();

    assert.equal(screen.queryByText('Before'), null);
    assert.equal(wrapper().viewName, 'RNSSafeAreaView');
    assert.equal(wrapper().reactTag, tag, 'the same view');
    assert.equal(wrapper().props['justifyContent'], 'flex-end');
    assert.equal(wrapper().parent!.props['justifyContent'], undefined);
    assert.deepEqual(
      wrapper().parent!.children.map((child) => child.viewName),
      ['RNSSafeAreaView', 'RNSScreenStackHeaderConfig'],
    );
  });
});
