/**
 * Host primitives. Native views need a correct name; the JS composites need rebuilding.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Direction } from '@ng-native/device';
import { Engine } from '@ng-native/fabric';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

interface Primitives {
  events: string[];
  locked: { set(value: boolean): void };
}

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

const find = (fabric: FakeFabric, viewName: string): FakeFabricNode | undefined =>
  flatten(fabric.committed).find((node) => node.viewName === viewName);

describe('host primitives', () => {
  let Component: Type<unknown>;
  let fabric: FakeFabric;
  let instance: Primitives;
  let componentRef: Awaited<ReturnType<typeof render<Primitives>>>['componentRef'];
  // The engine's clock, stepped by `tick` rather than waited on, so a fade is sampled at a known
  // point however busy the machine is.
  let now: number;
  const tick = (ms: number) => {
    now += ms;
    const engine = componentRef.injector.get(Engine);
    engine.advanceAnimations();
    engine.commit();
  };

  before(async () => {
    const mod = await compileFixture(fixture('primitives.ts'));
    Component = mod['Primitives'] as Type<unknown>;
  });

  beforeEach(async () => {
    now = 1000;
    const rendered = await render<Primitives>(Component as Type<Primitives>, { now: () => now });
    fabric = rendered.fabric;
    instance = rendered.instance;
    componentRef = rendered.componentRef;
  });

  afterEach(() => {
    // Run out the clock whatever happened: an assertion failing mid-fade would otherwise leave the
    // frame pump rescheduling on a clock that never moves, and the process would never exit.
    tick(1e9);
    cleanup();
  });

  it('commits every native primitive under its canonical Fabric name', () => {
    // Taken from RCTFabricComponentsPlugins.mm, not guessed. Legacy RCT-prefixed names only
    // work via componentNameByReactViewName, an explicitly transitional shim.
    //
    // `SafeAreaView` is not in this list any more: it is React Native's own, deprecated, iOS-only
    // and edge-less, and `<safe-area-view>` now commits react-native-safe-area-context's
    // `RNCSafeAreaView` instead. Its own suite covers that.
    for (const viewName of [
      'Paragraph',
      'Image',
      'ActivityIndicatorView',
      'Switch',
      'TextInput',
      'ScrollView',
      'PullToRefreshView',
      'ModalHostView',
      'View',
    ]) {
      assert.ok(find(fabric, viewName), `${viewName} was committed`);
    }
  });

  it('never commits an UnimplementedNativeView', () => {
    const unknown = flatten(fabric.committed).filter((n) => n.viewName.startsWith('Unimplemented'));
    assert.deepEqual(unknown, []);
  });

  it('commits nested text as a span, not a nested paragraph', () => {
    // RN models this as Paragraph > [RawText, Text > RawText]. A Paragraph inside a Paragraph
    // lays out as a separate block instead of flowing inline.
    const paragraph = find(fabric, 'Paragraph')!;
    assert.deepEqual(
      paragraph.children.map((child) => child.viewName),
      ['RawText', 'VirtualText'],
      'the span is sent as VirtualText: the canonical name Text is rewritten to Paragraph',
    );
    assert.equal(paragraph.children[1]!.children[0]!.viewName, 'RawText');
    assert.equal(find(fabric, 'Text'), undefined, 'never send the literal name Text');
  });

  it('synthesises press from the touch primitives', async () => {
    const pressable = flatten(fabric.committed).find((n) =>
      n.children.some((c) => c.children.some((g) => g.props['text'] === 'press me')),
    )!;

    await fireEvent.press(pressable);

    assert.deepEqual(instance.events, ['pressIn', 'press']);
  });

  it('presses when the touch lands on a child, not the pressable itself', async () => {
    // The label fills most of a button, so this is the common case, not an edge case. Fabric
    // hands JS only the hit target; propagation up the tree is our job.
    const label = flatten(fabric.committed).find((n) => n.props['text'] === 'press me')!;

    await fireEvent.press(label);

    assert.deepEqual(instance.events, ['pressIn', 'press']);
  });

  it('does not propagate direct events like scroll past their target', async () => {
    const scrolled: string[] = [];
    const scrollView = find(fabric, 'ScrollView')!;
    const inner = scrollView.children[0]!;

    const engine = componentRef.injector.get(Engine);
    engine.setEventListener(scrollView.instanceHandle as never, 'topScroll', () =>
      scrolled.push('scroll-view'),
    );
    engine.setEventListener(inner.instanceHandle as never, 'topScroll', () =>
      scrolled.push('inner'),
    );

    fabric.emit(inner, 'topScroll');
    assert.deepEqual(scrolled, ['inner'], 'stops at the target');
  });

  it('does not press when disabled', async () => {
    const pressable = flatten(fabric.committed).find((n) =>
      n.children.some((c) => c.children.some((g) => g.props['text'] === 'press me')),
    )!;

    instance.locked.set(true);
    await settle();
    await fireEvent.press(pressable);

    assert.deepEqual(instance.events, []);
  });

  it('drops the press when the touch is cancelled', async () => {
    const pressable = flatten(fabric.committed).find((n) =>
      n.children.some((c) => c.children.some((g) => g.props['text'] === 'press me')),
    )!;

    await fireEvent(pressable, 'touchStart');
    await fireEvent(pressable, 'touchCancel');
    await fireEvent(pressable, 'touchEnd');

    assert.deepEqual(instance.events, ['pressIn'], 'pressIn only, no press');
  });

  const withLabel = (fabric: FakeFabric, label: string) =>
    flatten(fabric.committed).find((n) =>
      n.children.some((c) => c.children.some((g) => g.props['text'] === label)),
    )!;

  it('fades touchable-opacity while pressed, and eases rather than snapping', async () => {
    const fading = () => withLabel(fabric, 'fade me');
    const dimmed = () => withLabel(fabric, 'dim already');

    // Stated by the component's own rule, so the transition has a value to ease from. A caller
    // with an opacity of its own still wins, because inline style beats the cascade.
    assert.equal(fading().props['opacity'], 1);
    assert.equal(dimmed().props['opacity'], 0.8, "the caller's own opacity is untouched");

    await fireEvent(fading(), 'touchStart');
    // Halfway through the 150ms fade in. A value at either end here would mean the transition
    // never ran and the component had simply set the target, which is what it used to do.
    tick(75);
    const midway = fading().props['opacity'] as number;
    // ease-in-out is symmetric, so halfway in time is halfway in value, to the solver's precision.
    assert.ok(Math.abs(midway - 0.75) < 1e-5, `midway through the fade, not ${midway}`);

    tick(75);
    assert.equal(fading().props['opacity'], 0.5, 'and it arrives');
  });

  it('eases back and then lets go, handing the style back to the caller', async () => {
    const fading = () => withLabel(fabric, 'fade me');

    await fireEvent(fading(), 'touchStart');
    tick(150);
    // Held past the pressable's 130ms minPressDuration, a real timer, so the release is not
    // deferred. Only a lower bound: a slow machine holds longer, which changes nothing.
    await new Promise((resolve) => setTimeout(resolve, 140));
    await fireEvent(fading(), 'touchEnd');

    tick(125);
    const returning = fading().props['opacity'] as number;
    assert.ok(Math.abs(returning - 0.75) < 1e-5, `halfway back, not ${returning}`);

    // `transitionend` is what hands the opacity back; without it the binding would sit on 1 for
    // ever and a caller changing their own opacity would be overruled.
    tick(125);
    await settle();
    assert.equal(fading().props['opacity'], 1, 'back to rest, and the binding let go');
  });

  it('applies contentContainerStyle to a wrapper view, as RN does', () => {
    // The native ScrollView has no such prop; without the wrapper it is silently dropped.
    const scrollView = find(fabric, 'ScrollView')!;
    const content = scrollView.children.find((child) => child.viewName === 'View')!;

    assert.equal(content.props['padding'], 16, 'the content wrapper carries the style');
    assert.equal(scrollView.props['padding'], undefined, 'not the scroll view itself');
  });

  it('keeps the content container from being flattened away', () => {
    // Fabric drops views whose props are layout-only, and a padding-only container qualifies.
    // With no UIView, touches over the container's empty areas land on the scroll view itself,
    // which does not scroll from a direct hit: dragging anywhere between children does nothing.
    const scrollView = find(fabric, 'ScrollView')!;
    const content = scrollView.children.find((child) => child.viewName === 'View')!;

    assert.equal(content.props['collapsable'], false);
  });

  it('gives the scroll view the base style RN applies, so it clips', () => {
    // The native ScrollView does not clip on its own. Without overflow:'scroll' the content
    // spills out of its bounds, which looks like a bug in the content.
    const scrollView = find(fabric, 'ScrollView')!;
    assert.equal(scrollView.props['overflow'], 'scroll');
    assert.equal(scrollView.props['flexGrow'], 1);
  });

  it('lays an absolutely-filled image behind image-background content', () => {
    const images = flatten(fabric.committed).filter((n) => n.viewName === 'Image');
    const background = images.find((n) => n.props['position'] === 'absolute');

    assert.ok(background, 'the background image is absolutely positioned');
    assert.equal(background.props['resizeMode'], 'cover');
  });
});

describe('platform view names', () => {
  it('answers what a node commits as, for a host that is not the engine', async () => {
    const { viewNameOf } = await import('@ng-native/fabric');
    const paragraph = { kind: 'element', name: 'text', parent: null };

    assert.equal(viewNameOf({ kind: 'element', name: 'view', parent: null }), 'View');
    assert.equal(viewNameOf(paragraph), 'Paragraph');
    assert.equal(viewNameOf({ kind: 'element', name: 'text', parent: paragraph }), 'VirtualText');
    assert.equal(viewNameOf({ kind: 'text', name: '#text', parent: paragraph }), 'RawText');
    assert.equal(viewNameOf({ kind: 'element', name: 'pressable', parent: null }), 'View');
    assert.equal(viewNameOf({ kind: 'element', name: 'scroll-view', parent: null }), 'ScrollView');
    assert.equal(viewNameOf({ kind: 'element', name: 'app-habit-row', parent: null }), 'View');
  });

  it('swaps the components Android registers differently', async () => {
    const { registerViewName, registerPlatformComponents } = await import('@ng-native/fabric');
    const { ANDROID_VIEW_NAMES } = await import('../fabric/src/engine.ts');

    assert.deepEqual(Object.keys(ANDROID_VIEW_NAMES).sort(), [
      'activity-indicator',
      'input-accessory-view',
      'refresh-control',
      'safe-area-view',
      'switch',
      'text-input',
    ]);

    registerPlatformComponents('android');
    const { fabric } = await render(
      (await compileFixture(fixture('primitives.ts')))['Primitives'] as Type<unknown>,
    );

    assert.ok(find(fabric, 'AndroidSwitch'), 'switch -> AndroidSwitch');
    assert.ok(find(fabric, 'AndroidTextInput'), 'text-input -> AndroidTextInput');
    assert.ok(find(fabric, 'AndroidProgressBar'), 'activity-indicator -> AndroidProgressBar');

    cleanup();
    // Restore the defaults for any test that runs after this one.
    registerViewName('switch', 'Switch');
    registerViewName('text-input', 'TextInput');
    registerViewName('activity-indicator', 'ActivityIndicatorView');
  });
});

describe('modal and assets', () => {
  it('gives the modal host its position and children a container view', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/modal.ts', import.meta.url)),
    );
    const { fabric } = await render(mod['ModalHost'] as Type<unknown>);

    const hosts = flatten(fabric.committed).filter((n) => n.viewName === 'ModalHostView');
    assert.equal(hosts.length, 2);
    // Without these the modal mounts, covers the screen, swallows every touch and shows nothing.
    assert.equal(hosts[0]!.props['position'], 'absolute');
    assert.equal(hosts[0]!.props['visible'], true);

    const solid = hosts[0]!.children[0]!;
    assert.equal(solid.viewName, 'View', 'children live in a container view');
    assert.equal(solid.props['flex'], 1);
    assert.equal(solid.props['backgroundColor'], 'white');
    // Left to right by default, the same edge RN's own Modal.js pins the container to.
    assert.equal(solid.props['left'], 0);
    assert.equal(solid.props['right'], undefined);

    const seeThrough = hosts[1]!.children[0]!;
    assert.equal(seeThrough.props['backgroundColor'], 'transparent');

    cleanup();
  });

  it('pins the container to the trailing edge in a right-to-left layout', async () => {
    // RN's Modal.js computes `[side]: 0` once, from I18nManager, rather than `left: 0` always:
    // in RTL the container has to hug the right edge, or the backdrop starts from the wrong side.
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/modal.ts', import.meta.url)),
    );
    const { fabric } = await render(mod['ModalHost'] as Type<unknown>, {
      providers: [
        {
          provide: Direction.SOURCE,
          useValue: { current: () => 'rtl', subscribe: () => () => {} },
        },
      ],
    });

    const hosts = flatten(fabric.committed).filter((n) => n.viewName === 'ModalHostView');
    const solid = hosts[0]!.children[0]!;
    assert.equal(solid.props['right'], 0);
    assert.equal(solid.props['left'], undefined);

    cleanup();
  });

  describe('a hidden modal', () => {
    interface Hidden {
      open: { set(value: boolean): void };
      dismissed: number;
      presses: number;
    }
    const modalHosts = (fabric: FakeFabric) =>
      flatten(fabric.committed).filter((n) => n.viewName === 'ModalHostView');

    const renderOn = async (platform: string) => {
      const { registerPlatformComponents } = await import('@ng-native/fabric');
      registerPlatformComponents(platform);
      const mod = await compileFixture(fixture('modal.ts'));
      return render<Hidden>(mod['HiddenModal'] as Type<Hidden>);
    };

    afterEach(async () => {
      cleanup();
      const { registerPlatformComponents, registerViewName } = await import('@ng-native/fabric');
      registerPlatformComponents('ios');
      registerViewName('switch', 'Switch');
      registerViewName('text-input', 'TextInput');
      registerViewName('activity-indicator', 'ActivityIndicatorView');
      registerViewName('refresh-control', 'PullToRefreshView');
      registerViewName('input-accessory-view', 'InputAccessoryView');
    });

    it('is not committed at all, so it cannot cover the screen', async () => {
      const { fabric, instance } = await renderOn('ios');
      assert.equal(modalHosts(fabric).length, 0, 'no native host while visible is false');
      assert.ok(flatten(fabric.committed).some((n) => n.props['text'] === 'screen'));

      instance.open.set(true);
      await settle();
      assert.equal(modalHosts(fabric).length, 1);
      assert.equal(modalHosts(fabric)[0]!.props['visible'], true);
    });

    it('stays until iOS reports the dismissal, then leaves the tree', async () => {
      const { fabric, instance } = await renderOn('ios');
      instance.open.set(true);
      await settle();

      instance.open.set(false);
      await settle();
      const [host] = modalHosts(fabric);
      assert.equal(host?.props['visible'], false, 'native is told to dismiss, animated');

      await fireEvent(host!, 'dismiss');
      assert.equal(instance.dismissed, 1, '(dismiss) still fires');
      assert.equal(modalHosts(fabric).length, 0);

      instance.open.set(true);
      await settle();
      assert.equal(modalHosts(fabric)[0]?.props['visible'], true, 'and it can be shown again');
    });

    // Native drops a view's event target when it unmounts, so a host committed again from the
    // handles it had before would ignore every touch.
    for (const platform of ['ios', 'android']) {
      it(`takes touches when shown a second time on ${platform}`, async () => {
        const { fabric, instance } = await renderOn(platform);
        for (let shown = 1; shown <= 2; shown++) {
          instance.open.set(true);
          await settle();
          await fireEvent.press(screen.getByText('sheet'));
          assert.equal(instance.presses, shown, `presentation ${shown} takes the press`);

          instance.open.set(false);
          await settle();
          const [host] = modalHosts(fabric);
          if (host) await fireEvent(host, 'dismiss');
          assert.equal(modalHosts(fabric).length, 0);
        }
      });
    }

    it('leaves the tree at once on Android, as Modal.js does there', async () => {
      const { fabric, instance } = await renderOn('android');
      instance.open.set(true);
      await settle();
      assert.equal(modalHosts(fabric).length, 1);

      instance.open.set(false);
      await settle();
      assert.equal(modalHosts(fabric).length, 0);
    });
  });

  it('runs image sources through resolveAssetSource', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/modal.ts', import.meta.url)),
    );
    const seen: unknown[] = [];
    const { fabric } = await render(mod['ModalHost'] as Type<unknown>, {
      // Stands in for RN's resolver: numbers are asset ids, objects pass through.
      resolveAssetSource: (value) => {
        seen.push(value);
        return typeof value === 'number' ? { uri: `asset://${value}`, width: 8, height: 8 } : value;
      },
    });

    assert.deepEqual(seen, [42, { uri: 'https://example.invalid/x.png' }]);
    // A list, as RN's Image sends it: native picks the best fit when there are several.
    const images = flatten(fabric.committed).filter((n) => n.viewName === 'Image');
    assert.deepEqual(images[0]!.props['source'], [{ uri: 'asset://42', width: 8, height: 8 }]);
    assert.deepEqual(images[1]!.props['source'], [{ uri: 'https://example.invalid/x.png' }]);
    // A resolved asset's own size is the default box, as an <img> sizes itself.
    assert.equal(images[0]!.props['width'], 8);
    assert.equal(images[0]!.props['height'], 8);

    cleanup();
  });
});
