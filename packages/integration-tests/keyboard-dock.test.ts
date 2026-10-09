/**
 * A bar on the keyboard, as a chat's composer is. On iOS with react-native-keyboard-controller,
 * native moves it by the keyboard's height every frame - an interactive dismissal included, which
 * no layout driven by keyboard events can follow, because iOS reports the keyboard's frame only
 * once the finger lets go. Otherwise it sits in flow, padded clear of the keyboard.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Provider, Type } from '@angular/core';
import { Keyboard, SafeArea, type KeyboardMetrics } from '@ng-native/device';
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

async function boot(name = 'DockedComposer', controller = false) {
  const listeners = new Set<(metrics: KeyboardMetrics) => void>();
  const { native, named, drives } = recorder();
  const rendered = await render(mod[name] as Type<unknown>, {
    nativeAnimated: native,
    providers: [
      ...(controller ? [(mod['provideKeyboardController'] as () => Provider)()] : []),
      {
        provide: Keyboard.SOURCE,
        useValue: {
          subscribe: (listener: (metrics: KeyboardMetrics) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          dismiss: () => {},
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
});
