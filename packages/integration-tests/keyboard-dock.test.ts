/**
 * A bar on the keyboard, as a chat's composer is. On iOS with react-native-keyboard-controller,
 * native moves it by the keyboard's height every frame - an interactive dismissal included, which
 * no layout driven by keyboard events can follow, because iOS reports the keyboard's frame only
 * once the finger lets go. On Android with `KEYBOARD_MOTION`, native moves it by how far the
 * keyboard covers it, every frame. Otherwise it sits in flow, padded clear of the keyboard.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Provider, Type } from '@angular/core';
import { KEYBOARD_MOTION, Keyboard, SafeArea, type KeyboardMetrics } from '@ng-native/device';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, fireEvent, render, screen, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { recorder } from './native-animated.ts';

afterEach(() => {
  cleanup();
  registerPlatformComponents('ios');
});

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/keyboard-dock.ts');
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/** The motion view's name, as `@ng-native/expo` would provide it. */
const MOTION_VIEW = 'ViewManagerAdapter_NgNativeKeyboard';

async function boot(
  name = 'DockedComposer',
  controller = false,
  motion = false,
  windowTop: number | (() => number) = 0,
) {
  const listeners = new Set<(metrics: KeyboardMetrics) => void>();
  const { native, named, drives } = recorder();
  const rendered = await render(mod[name] as Type<unknown>, {
    nativeAnimated: native,
    providers: [
      ...(controller ? [(mod['provideKeyboardController'] as () => Provider)()] : []),
      ...(motion ? [{ provide: KEYBOARD_MOTION, useValue: { viewName: MOTION_VIEW } }] : []),
      {
        provide: Keyboard.SOURCE,
        useValue: {
          subscribe: (listener: (metrics: KeyboardMetrics) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          dismiss: () => {},
          get windowTop() {
            return typeof windowTop === 'function' ? windowTop() : windowTop;
          },
        },
      },
    ],
  });
  const keyboard = async (metrics: KeyboardMetrics) => {
    for (const listener of listeners) listener(metrics);
    await settle();
  };
  const safeArea = rendered.componentRef.injector.get(SafeArea);
  const bottom = async (inset: number) => {
    safeArea.report(
      { top: 47, right: 0, bottom: inset, left: 0 },
      { x: 0, y: 0, width: 402, height: 874 },
    );
    await settle();
  };
  return { ...rendered, keyboard, bottom, named, drives };
}

describe('keyboard dock on iOS with react-native-keyboard-controller', () => {
  it('has native move the bar by the keyboard, frame by frame, from above the home indicator', async () => {
    const { fabric, bottom, named, drives } = await boot('DockedComposer', true);
    await bottom(34);
    const dock = screen.getByTestId('dock');
    assert.equal(dock.props['paddingBottom'], 34, 'docked above the home indicator');
    const controller = flatten(fabric.committed).find(
      (node) => node.viewName === 'KeyboardControllerView',
    )!;
    assert.equal(controller.props['enabled'], true);
    assert.deepEqual(
      named('event').map(([, tag, name]) => [tag, name]),
      [
        [controller.reactTag, 'onKeyboardMove'],
        [controller.reactTag, 'onKeyboardMoveInteractive'],
        [controller.reactTag, 'onKeyboardMoveEnd'],
      ],
      'every frame of the keyboard, a drag included',
    );
    const bar = dock.children.at(-1)!;
    assert.deepEqual(
      drives().get(bar.reactTag)?.inputRange,
      [34, 10034],
      'the bar rises once the keyboard is past the inset it already sits above',
    );
    assert.equal(
      flatten(fabric.committed).some((node) => node.viewName === 'InputAccessoryView'),
      false,
      'and is no input accessory, whose safe-area layout loops once a drag nears the bottom',
    );
  });

  it('lets a drag take the keyboard from the top of the bar, as Messages does', async () => {
    const { fabric } = await boot('DockedComposer', true);
    const dock = screen.getByTestId('dock');
    await fireEvent(dock.children.at(-1)!, 'layout', {
      layout: { x: 0, y: 0, width: 402, height: 52 },
    });
    const area = flatten(fabric.committed).find((node) => node.viewName === 'KeyboardGestureArea')!;
    assert.equal(area.props['offset'], 52);
    assert.equal(area.props['textInputNativeID'], 'composer', 'for the field in the bar');
  });

  it('names a field that has no id, for the drag area to find', async () => {
    const { fabric } = await boot('LiftedComposer', true);
    const field = flatten(fabric.committed).find((node) => node.viewName === 'TextInput')!;
    const area = flatten(fabric.committed).find((node) => node.viewName === 'KeyboardGestureArea')!;
    assert.ok(field.props['nativeID']);
    assert.equal(area.props['textInputNativeID'], field.props['nativeID']);
  });

  it('moves content above with the bar where it asks to be', async () => {
    const { fabric, bottom, drives, named } = await boot('LiftedComposer', true);
    await bottom(34);
    const controller = flatten(fabric.committed).find(
      (node) => node.viewName === 'KeyboardControllerView',
    )!;
    assert.deepEqual(
      [...new Set(named('event').map(([, tag]) => tag))],
      [controller.reactTag],
      'by the keyboard the controller reports, even though it is written before the dock',
    );
    assert.deepEqual(
      drives().get(screen.getByTestId('transcript').reactTag)?.inputRange,
      [34, 10034],
    );
  });

  it('keeps a lifted scroll view clear of the keyboard in layout, once it has moved', async () => {
    // Since iOS 26 a scroll view the keyboard overlaps draws a frosted edge effect over what the
    // keyboard covers, and a transform is not where it looks: it goes by the layout. So the lifted
    // view is padded by the keyboard once it has moved, and its translate less the same amount,
    // which leaves it where it was on screen.
    const { fabric, bottom, named } = await boot('LiftedComposer', true);
    await bottom(34);
    const controller = flatten(fabric.committed).find(
      (node) => node.viewName === 'KeyboardControllerView',
    )!;
    await fireEvent(controller, 'keyboardMoveStart', { height: 336 });
    assert.equal(screen.getByTestId('transcript').props['paddingBottom'], 302);
    assert.equal(named('set').at(-1)![2], 302, 'and the translate is shifted back by as much');
    await fireEvent(controller, 'keyboardMoveStart', { height: 0 });
    assert.equal(screen.getByTestId('transcript').props['paddingBottom'], null, 'cleared');
    assert.equal(named('set').at(-1)![2], 0);
  });

  it('reports how much the keyboard covers beyond the dock, once it has moved', async () => {
    const { fabric, bottom } = await boot('DockedComposer', true);
    await bottom(34);
    const controller = flatten(fabric.committed).find(
      (node) => node.viewName === 'KeyboardControllerView',
    )!;
    await fireEvent(controller, 'keyboardMoveEnd', { height: 336 });
    assert.equal(screen.getByTestId('transcript').props['paddingBottom'], 302);
    await fireEvent(controller, 'keyboardMoveStart', { height: 0 });
    assert.equal(screen.getByTestId('transcript').props['paddingBottom'], 0);
  });
});

describe('keyboard dock on iOS without it', () => {
  it('sits in flow, padded by as much of the keyboard as covers it', async () => {
    const { fabric, keyboard, bottom } = await boot();
    await bottom(34);
    assert.equal(
      flatten(fabric.committed).some(
        (node) =>
          node.viewName === 'InputAccessoryView' || node.viewName === 'KeyboardControllerView',
      ),
      false,
    );
    assert.equal(screen.getByTestId('dock').props['paddingBottom'], 34);
    fabric.frames.set('dock', { x: 0, y: 786, width: 402, height: 88 });
    await fireEvent(screen.getByTestId('dock'), 'layout', {
      layout: { x: 0, y: 786, width: 402, height: 88 },
    });
    await keyboard({ height: 336, screenY: 538 });
    assert.equal(screen.getByTestId('dock').props['paddingBottom'], 336);
  });
});

describe('keyboard dock on Android', () => {
  it('sits in flow, clear of the navigation bar while the keyboard is down', async () => {
    registerPlatformComponents('android');
    const { fabric, bottom } = await boot();
    assert.equal(
      flatten(fabric.committed).some((node) => node.viewName === 'InputAccessoryView'),
      false,
    );
    await bottom(24);
    assert.equal(screen.getByTestId('dock').props['paddingBottom'], 24);
    assert.equal(screen.getByTestId('transcript').props['paddingBottom'], 0, 'nothing is covered');
  });

  it('is padded clear of a keyboard that covers it, and not of one that resized the window', async () => {
    registerPlatformComponents('android');
    const { fabric, keyboard, bottom } = await boot();
    await bottom(24);
    // The dock's bottom edge is at the bottom of an 874pt window the keyboard does not resize.
    fabric.frames.set('dock', { x: 0, y: 820, width: 402, height: 54 });
    await fireEvent(screen.getByTestId('dock'), 'layout', {
      layout: { x: 0, y: 820, width: 402, height: 54 },
    });
    await keyboard({ height: 300, screenY: 574 });
    assert.equal(screen.getByTestId('dock').props['paddingBottom'], 300);

    // A window resized for the keyboard already puts the dock above it.
    fabric.frames.set('dock', { x: 0, y: 520, width: 402, height: 54 });
    await fireEvent(screen.getByTestId('dock'), 'layout', {
      layout: { x: 0, y: 520, width: 402, height: 54 },
    });
    assert.equal(screen.getByTestId('dock').props['paddingBottom'], 0);
  });

  it('is padded by the whole overlap where the window starts below the status bar', async () => {
    // React Native measures from below a 34 point status bar here, and reports the keyboard's top
    // from the top of the screen.
    registerPlatformComponents('android');
    const { fabric, keyboard, bottom } = await boot('DockedComposer', false, false, 34);
    await bottom(24);
    fabric.frames.set('dock', { x: 0, y: 744, width: 402, height: 54 });
    await fireEvent(screen.getByTestId('dock'), 'layout', {
      layout: { x: 0, y: 744, width: 402, height: 54 },
    });
    await keyboard({ height: 358, screenY: 474 });
    // The dock's bottom is at 798 in the window, the keyboard's top at 474 - 34 = 440.
    assert.equal(screen.getByTestId('dock').props['paddingBottom'], 358);
  });

  it('stays on the keyboard when the status bar is hidden while it is up', async () => {
    // Expo Go on Android: hiding the bar moves nothing on the screen, and React Native keeps
    // measuring from below where the bar was, its root 24 points up, until the root is laid out
    // again. The bar's own height, which the platform reports at once, is 0 by then.
    registerPlatformComponents('android');
    let bar = 24;
    const { fabric, keyboard, bottom } = await boot('DockedComposer', false, false, () => bar);
    // The app's root, drawn from the top of the screen and measured from below the bar.
    fabric.frames.set('View', { x: 0, y: -24, width: 402, height: 874 });
    await bottom(24);
    fabric.frames.set('dock', { x: 0, y: 744, width: 402, height: 54 });
    await fireEvent(screen.getByTestId('dock'), 'layout', {
      layout: { x: 0, y: 744, width: 402, height: 54 },
    });
    await keyboard({ height: 358, screenY: 464 });
    // The dock's bottom is at 798 in the window, 822 on the screen; the keyboard's top at 464.
    assert.equal(screen.getByTestId('dock').props['paddingBottom'], 358);
    bar = 0;
    await keyboard({ height: 358, screenY: 464 });
    assert.equal(screen.getByTestId('dock').props['paddingBottom'], 358, 'the bar hidden');
  });

  it('stays in flow with react-native-keyboard-controller, whose view adds the navigation bar as margins around the app', async () => {
    registerPlatformComponents('android');
    const { fabric, keyboard, bottom, named } = await boot('DockedComposer', true);
    await bottom(24);
    assert.equal(
      flatten(fabric.committed).some((node) => node.viewName === 'KeyboardControllerView'),
      false,
    );
    assert.deepEqual(named('event'), []);
    fabric.frames.set('dock', { x: 0, y: 820, width: 402, height: 54 });
    await fireEvent(screen.getByTestId('dock'), 'layout', {
      layout: { x: 0, y: 820, width: 402, height: 54 },
    });
    await keyboard({ height: 300, screenY: 574 });
    assert.equal(screen.getByTestId('dock').props['paddingBottom'], 300);
    await keyboard({ height: 0 });
    assert.equal(
      screen.getByTestId('dock').props['paddingBottom'],
      24,
      'and back once it has gone',
    );
  });
});

describe('keyboard dock on Android with the keyboard motion view', () => {
  const motionView = (fabric: { committed: readonly FakeFabricNode[] }) =>
    flatten(fabric.committed).find((node) => node.viewName === MOTION_VIEW)!;

  it('has native move the bar by how far the keyboard covers the dock, frame by frame', async () => {
    registerPlatformComponents('android');
    const { fabric, bottom, named, drives } = await boot('DockedComposer', true, true);
    await bottom(24);
    const dock = screen.getByTestId('dock');
    assert.equal(dock.props['paddingBottom'], 24, 'docked above the navigation bar');
    const view = motionView(fabric);
    assert.ok(view, 'the motion view is committed in the dock');
    assert.deepEqual(
      [view.props['position'], view.props['top'], view.props['bottom'], view.props['width']],
      ['absolute', 0, 0, 0],
      "over the dock, so its bottom edge is the dock's, and out of the way of the layout",
    );
    assert.equal(
      flatten(fabric.committed).some(
        (node) =>
          node.viewName === 'KeyboardControllerView' || node.viewName === 'KeyboardGestureArea',
      ),
      false,
      'react-native-keyboard-controller is not used, though it is provided',
    );
    assert.deepEqual(
      named('event').map(([, tag, name]) => [tag, name]),
      [
        [view.reactTag, 'onKeyboardMove'],
        [view.reactTag, 'onKeyboardMoveInteractive'],
        [view.reactTag, 'onKeyboardMoveEnd'],
      ],
    );
    assert.deepEqual(
      drives().get(dock.children.at(-1)!.reactTag)?.inputRange,
      [24, 10024],
      'the bar rises once the keyboard covers more of the dock than the inset it sits above',
    );
  });

  it('is not padded by the keyboard events, which native has already moved it clear of', async () => {
    registerPlatformComponents('android');
    const { fabric, keyboard, bottom } = await boot('DockedComposer', false, true);
    await bottom(24);
    fabric.frames.set('dock', { x: 0, y: 820, width: 402, height: 54 });
    await fireEvent(screen.getByTestId('dock'), 'layout', {
      layout: { x: 0, y: 820, width: 402, height: 54 },
    });
    await keyboard({ height: 300, screenY: 574 });
    assert.equal(screen.getByTestId('dock').props['paddingBottom'], 24);
  });

  it('reports how much the keyboard covers beyond the dock, once it has moved', async () => {
    registerPlatformComponents('android');
    const { fabric, bottom } = await boot('DockedComposer', false, true);
    await bottom(24);
    await fireEvent(motionView(fabric), 'keyboardMoveEnd', { height: 324 });
    assert.equal(screen.getByTestId('transcript').props['paddingBottom'], 300);
    await fireEvent(motionView(fabric), 'keyboardMoveStart', { height: 0 });
    assert.equal(screen.getByTestId('transcript').props['paddingBottom'], 0);
  });

  it('moves content above with the bar where it asks to be', async () => {
    registerPlatformComponents('android');
    const { fabric, bottom, drives, named } = await boot('LiftedComposer', false, true);
    await bottom(24);
    assert.deepEqual(
      [...new Set(named('event').map(([, tag]) => tag))],
      [motionView(fabric).reactTag],
    );
    assert.deepEqual(
      drives().get(screen.getByTestId('transcript').reactTag)?.inputRange,
      [24, 10024],
    );
  });

  it('is not used on iOS, where the controller reports the keyboard', async () => {
    const { fabric } = await boot('DockedComposer', false, true);
    assert.equal(
      flatten(fabric.committed).some((node) => node.viewName === MOTION_VIEW),
      false,
    );
    assert.equal(
      flatten(fabric.committed).some((node) => node.viewName === 'KeyboardControllerView'),
      false,
      'nor anything else without the controller',
    );
  });
});
