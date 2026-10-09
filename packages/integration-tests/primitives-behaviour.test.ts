/**
 * What React Native's JavaScript wrappers do on top of the native views, rebuilt on the
 * primitives: press timing, keyboard policy, value echo, and the small translations each
 * wrapper does before native sees a prop.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Keyboard } from '@ng-native/device';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  type FakeFabric,
  type FakeFabricNode,
  type RenderOptions,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);
const byID = (fabric: FakeFabric, id: string) => screen.getByTestId(id);
const touch = (node: FakeFabricNode, type: string, x = 0, y = 0) =>
  fireEvent(node, type, { pageX: x, pageY: y, touches: type === 'topTouchEnd' ? [] : [{}] });

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/behaviours.ts');
});

async function boot<T>(
  name: string,
  options: RenderOptions<T> = {},
): Promise<{ fabric: FakeFabric; instance: T }> {
  const { fabric, instance } = await render(mod[name] as Type<T>, options);
  return { fabric, instance };
}

describe('press timing', () => {
  it('fires longPress after the delay and then withholds press', async () => {
    const { fabric, instance } = await boot<{ log: string[] }>('PressTiming');
    const btn = byID(fabric, 'btn');
    await touch(btn, 'topTouchStart');
    await wait(90);
    await touch(btn, 'topTouchEnd');
    await wait(60);
    assert.deepEqual(instance.log, ['in', 'long', 'out']);
  });

  it('keeps the pressed look for minPressDuration on a quick tap', async () => {
    const { fabric, instance } = await boot<{ log: string[] }>('PressTiming');
    const btn = byID(fabric, 'btn');
    await touch(btn, 'topTouchStart');
    await touch(btn, 'topTouchEnd');
    assert.deepEqual(instance.log, ['in', 'press'], 'pressOut waits');
    await wait(60);
    assert.deepEqual(instance.log, ['in', 'press', 'out']);
  });

  it('still counts a tap that lifts before delayPressIn', async () => {
    const { fabric, instance } = await boot<{ log: string[]; delayIn: { set(v: number): void } }>(
      'PressTiming',
    );
    instance.delayIn.set(1000);
    await wait(0);
    const btn = byID(fabric, 'btn');
    await touch(btn, 'topTouchStart');
    await touch(btn, 'topTouchEnd');
    await wait(60);
    assert.deepEqual(instance.log, ['in', 'press', 'out']);
  });
});

describe('text presses', () => {
  it('claims touches only when pressable, and highlights while pressed', async () => {
    const { fabric, instance } = await boot<{ log: string[] }>('TextPress');
    await touch(byID(fabric, 'plain'), 'topTouchStart');
    await touch(byID(fabric, 'plain'), 'topTouchEnd');
    assert.deepEqual(instance.log, []);
    assert.equal(byID(fabric, 'plain').props['onLayout'], undefined, 'a label is not measured');

    await touch(byID(fabric, 'link'), 'topTouchStart');
    assert.equal(byID(fabric, 'link').props['isHighlighted'], true);
    assert.equal(byID(fabric, 'link').props['isPressable'], true);
    await touch(byID(fabric, 'link'), 'topTouchEnd');
    assert.deepEqual(instance.log, ['link']);
  });
});

describe('text input', () => {
  it('emits changeText and derives submitBehavior from multiline', async () => {
    const { fabric, instance } = await boot<{ log: string[]; draft(): string }>('InputForm');
    assert.equal(byID(fabric, 'single').props['submitBehavior'], 'blurAndSubmit');
    assert.equal(byID(fabric, 'multi').props['submitBehavior'], 'newline');
    assert.equal(byID(fabric, 'multi').props['scrollEnabled'], false, 'grows rather than scrolls');
    assert.equal(
      byID(fabric, 'forced').props['submitBehavior'],
      'blurAndSubmit',
      'one line has no newline',
    );

    await fireEvent(byID(fabric, 'single'), 'change', { text: 'hi', eventCount: 1 });
    assert.deepEqual(instance.log, ['hi']);
    assert.equal(instance.draft(), 'hi');
  });

  it('pushes a value set from code with the count native expects', async () => {
    const { fabric, instance } = await boot<{
      draft: { set(v: string): void };
      single(): { clear(): void };
    }>('InputForm');
    await fireEvent(byID(fabric, 'single'), 'change', { text: 'typed', eventCount: 3 });
    assert.equal(fabric.commands.length, 0, 'an echo needs no command');

    instance.draft.set('replaced');
    await wait(0);
    assert.deepEqual(fabric.commands, [
      { viewName: 'TextInput', name: 'setTextAndSelection', args: [3, 'replaced', -1, -1] },
    ]);

    instance.single().clear();
    await wait(0);
    assert.deepEqual(fabric.commands.at(-1)!.args, [3, '', -1, -1]);
  });
});

describe('pull to refresh', () => {
  it('stops the spinner when the app does not take the refresh', async () => {
    const { fabric, instance } = await boot<{ log: string[] }>('Refresh');
    const control = flatten(fabric.committed).find((n) => n.viewName === 'PullToRefreshView')!;
    await fireEvent(control, 'refresh', {});
    assert.deepEqual(instance.log, ['refresh']);
    assert.deepEqual(fabric.commands, [
      { viewName: 'PullToRefreshView', name: 'setNativeRefreshing', args: [false] },
    ]);
  });

  it('leaves the spinner alone when the app sets refreshing', async () => {
    const { fabric, instance } = await boot<{ refreshing: { set(v: boolean): void } }>('Refresh');
    const control = flatten(fabric.committed).find((n) => n.viewName === 'PullToRefreshView')!;
    // Fire without awaiting yet: the emit itself is synchronous, so setting `refreshing` right
    // after it lands in the same commit as the echo, before the one `await` below settles both.
    const refreshed = fireEvent(control, 'refresh', {});
    instance.refreshing.set(true);
    await refreshed;
    assert.equal(fabric.commands.length, 0, 'the echo alone sends no command');
    instance.refreshing.set(false);
    await wait(0);
    assert.deepEqual(
      fabric.commands.map((c) => c.args),
      [[false]],
    );
  });
});

describe('a horizontal scroll view', () => {
  /**
   * A scroll view scrolls sideways only if its host lays out in a row. RN swaps its whole base
   * style for `baseHorizontal` when `horizontal` is set - `flexDirection: 'row'` - and puts
   * `contentContainerHorizontal` on the content view as well.
   *
   * With the host left as a column the content view is stretched to the scroll view's width
   * instead of growing past it, so there is nothing to scroll to and the drag does nothing. It
   * looks exactly like a scroll view with too little content.
   */
  it('lays its host and its content container out in a row', async () => {
    const { fabric } = await boot('HorizontalScroll');
    const sideways = byID(fabric, 'sideways');
    const upright = byID(fabric, 'upright');

    assert.equal(sideways?.props['flexDirection'], 'row', 'the host has to be a row');
    assert.equal(upright?.props['flexDirection'], 'column', 'and a plain one stays a column');
    assert.equal(sideways?.props['alwaysBounceHorizontal'], true);
    assert.equal(sideways?.props['alwaysBounceVertical'], false);
    assert.equal(upright?.props['alwaysBounceHorizontal'], false);
    assert.equal(upright?.props['alwaysBounceVertical'], true);

    // The engine flattens `style` into the props it commits, so these are top-level too.
    const content = sideways?.children[0];
    assert.equal(
      content?.props['flexDirection'],
      'row',
      'so does the content view, as RN does with contentContainerHorizontal',
    );
    assert.equal(content?.props['padding'], 8, 'without losing what the caller asked for');
  });
});

describe('scroll view keyboard policy', () => {
  it('dismisses the keyboard on a tap elsewhere, by default', async () => {
    const { fabric } = await boot('KeyboardTaps');
    await fireEvent(byID(fabric, 'field'), 'focus', {});
    await touch(byID(fabric, 'elsewhere'), 'topTouchStart');
    await touch(byID(fabric, 'elsewhere'), 'topTouchEnd');
    assert.deepEqual(fabric.commands, [{ viewName: 'TextInput', name: 'blur', args: [] }]);
  });

  it('leaves the keyboard up after a drag that scrolled', async () => {
    const { fabric } = await boot('KeyboardTaps');
    await fireEvent(byID(fabric, 'field'), 'focus', {});
    await touch(byID(fabric, 'elsewhere'), 'topTouchStart');
    await fireEvent.scroll(byID(fabric, 'never'), { contentOffset: { y: 30 } });
    await touch(byID(fabric, 'elsewhere'), 'topTouchEnd');
    assert.deepEqual(fabric.commands, []);
  });

  it('leaves the keyboard up for a tap on the field itself, or with taps persisting', async () => {
    const { fabric } = await boot('KeyboardTaps');
    await fireEvent(byID(fabric, 'field'), 'focus', {});
    await touch(byID(fabric, 'field'), 'topTouchStart');
    await touch(byID(fabric, 'field'), 'topTouchEnd');

    await fireEvent(byID(fabric, 'field2'), 'focus', {});
    await touch(byID(fabric, 'elsewhere2'), 'topTouchStart');
    await touch(byID(fabric, 'elsewhere2'), 'topTouchEnd');
    assert.deepEqual(fabric.commands, []);
  });

  it('exposes the scroll commands and reports content size', async () => {
    const { fabric, instance } = await boot<{
      scroll(): {
        scrollTo(o: object): void;
        contentSizeChange: { subscribe(fn: (s: object) => void): void };
      };
    }>('KeyboardTaps');
    const sizes: object[] = [];
    instance.scroll().contentSizeChange.subscribe((size) => sizes.push(size));
    instance.scroll().scrollTo({ y: 40, animated: false });
    assert.deepEqual(fabric.commands, [
      { viewName: 'ScrollView', name: 'scrollTo', args: [0, 40, false] },
    ]);

    const content = byID(fabric, 'never').children[0]!;
    await fireEvent(content, 'layout', { layout: { x: 0, y: 0, width: 300, height: 900 } });
    assert.deepEqual(sizes, [{ width: 300, height: 900 }]);
  });
});

describe('the props and behaviours other fixtures leave at their defaults', () => {
  it('dismisses the keyboard with taps handled, unless something inside takes the tap', async () => {
    const { fabric } = await boot('Odds');
    await fireEvent(byID(fabric, 'field3'), 'focus', {});
    await touch(byID(fabric, 'button3'), 'topTouchStart');
    await touch(byID(fabric, 'button3'), 'topTouchEnd');
    assert.deepEqual(fabric.commands, [], 'the pressable took it');
    await touch(byID(fabric, 'elsewhere3'), 'topTouchStart');
    await touch(byID(fabric, 'elsewhere3'), 'topTouchEnd');
    assert.deepEqual(fabric.commands, [{ viewName: 'TextInput', name: 'blur', args: [] }]);
  });

  it('reads a named deceleration rate as the number native takes', async () => {
    const { fabric } = await boot('Odds');
    assert.equal(byID(fabric, 'fast').props['decelerationRate'], 0.99);
  });

  it('sends an id as the nativeID', async () => {
    const { fabric } = await boot('Odds');
    assert.equal(byID(fabric, 'card-test').props['nativeID'], 'card');
  });

  it('selects a caret, not a range, when setSelection is given one position', async () => {
    const { fabric, instance } = await boot<{ input(): { setSelection(start: number): void } }>(
      'Odds',
    );
    instance.input().setSelection(3);
    assert.deepEqual(fabric.commands.at(-1)?.args.slice(1), [null, 3, 3]);
  });

  it('lists a src once when the srcSet already names it at 1x', async () => {
    const { fabric } = await boot('Odds');
    assert.deepEqual(byID(fabric, 'both').props['source'], [
      { uri: 'a.png', scale: 1 },
      { uri: 'a@2x.png', scale: 2 },
    ]);
  });

  it("keeps a source's own headers beside the ones crossOrigin adds", async () => {
    const { fabric } = await boot('Odds');
    assert.deepEqual(byID(fabric, 'headed').props['source'], [
      {
        uri: 'h.png',
        headers: { Authorization: 'token', 'Access-Control-Allow-Credentials': 'true' },
      },
    ]);
  });

  it('does not press a pressable text while it is disabled', async () => {
    const { fabric, instance } = await boot<{ log: string[] }>('Odds');
    await touch(byID(fabric, 'off'), 'topTouchStart');
    await touch(byID(fabric, 'off'), 'topTouchEnd');
    assert.deepEqual(instance.log, []);
  });
});

describe('virtual list as a scroll view', () => {
  it('takes the scroll view s native props as bindings', async () => {
    const { fabric } = await boot('ListKeyboard');
    const list = byID(fabric, 'transcript');
    assert.equal(list.props['keyboardDismissMode'], 'interactive');
    assert.equal(list.props['showsVerticalScrollIndicator'], false);
    assert.equal(list.props['bounces'], false);
    assert.deepEqual(list.props['contentInset'], { top: 0, bottom: 20, left: 0, right: 0 });
    assert.deepEqual(list.props['scrollIndicatorInsets'], {
      top: 0,
      bottom: 20,
      left: 0,
      right: 0,
    });
  });

  it('dismisses the keyboard on a tap in the list, by default, and not on the row', async () => {
    const { fabric } = await boot('ListKeyboard');
    await fireEvent(byID(fabric, 'composer'), 'focus', {});
    await touch(byID(fabric, 'message2'), 'topTouchStart');
    await touch(byID(fabric, 'message2'), 'topTouchEnd');
    assert.deepEqual(fabric.commands, [{ viewName: 'TextInput', name: 'blur', args: [] }]);
  });

  it('leaves the keyboard up after a drag that scrolled the list, as RN does', async () => {
    // RN's ScrollView dismisses on release only if it has not scrolled since the touch began: a
    // drag through a transcript is reading it, not tapping away from the composer.
    const { fabric } = await boot('ListKeyboard');
    await fireEvent(byID(fabric, 'composer'), 'focus', {});
    await touch(byID(fabric, 'message2'), 'topTouchStart');
    await fireEvent.scroll(byID(fabric, 'transcript'), { contentOffset: { y: 30 } });
    await touch(byID(fabric, 'message2'), 'topTouchEnd');
    assert.deepEqual(fabric.commands, []);

    // And the next tap, with no scroll, still dismisses.
    await touch(byID(fabric, 'message2'), 'topTouchStart');
    await touch(byID(fabric, 'message2'), 'topTouchEnd');
    assert.deepEqual(fabric.commands, [{ viewName: 'TextInput', name: 'blur', args: [] }]);
  });

  it('leaves the keyboard up when taps persist', async () => {
    const { fabric, instance } = await boot<{ persist: { set(v: string): void } }>('ListKeyboard');
    instance.persist.set('always');
    await fireEvent(byID(fabric, 'composer'), 'focus', {});
    await touch(byID(fabric, 'message2'), 'topTouchStart');
    await touch(byID(fabric, 'message2'), 'topTouchEnd');
    assert.deepEqual(fabric.commands, []);
  });
});

describe('image', () => {
  it('maps alt, srcSet and crossOrigin as RN does', async () => {
    const { fabric } = await boot('Images');
    const alt = byID(fabric, 'alt');
    assert.equal(alt.props['accessible'], true);
    assert.equal(alt.props['accessibilityLabel'], 'A picture');
    assert.deepEqual(alt.props['source'], [{ uri: 'a.png' }]);

    const set = byID(fabric, 'set');
    assert.deepEqual(set.props['source'], [
      { uri: 'a@2x.png', scale: 2, headers: { 'Access-Control-Allow-Credentials': 'true' } },
      { uri: 'a@3x.png', scale: 3, headers: { 'Access-Control-Allow-Credentials': 'true' } },
      { uri: 'a.png', scale: 1, headers: { 'Access-Control-Allow-Credentials': 'true' } },
    ]);
  });
});

describe('modal', () => {
  it('presents a transparent modal over full screen unless told otherwise', async () => {
    const { fabric } = await boot('Modals');
    assert.equal(byID(fabric, 'clear').props['presentationStyle'], 'overFullScreen');
    assert.equal(byID(fabric, 'sheet').props['presentationStyle'], 'pageSheet');
  });
});

describe('keyboard avoiding view', () => {
  it('measures the overlap from its own frame and the keyboard top', async () => {
    type Listener = (m: { height: number; screenY?: number }) => void;
    const listeners = new Set<Listener>();
    const listener: Listener = (metrics) => listeners.forEach((fn) => fn(metrics));
    const { fabric } = await boot('Avoiding', {
      providers: [
        {
          provide: Keyboard.SOURCE,
          useValue: {
            subscribe: (fn: Listener) => (listeners.add(fn), () => listeners.delete(fn)),
            dismiss: () => {},
          },
        },
      ],
    });
    // The padded view ends at y=600 on an 800pt screen; a 300pt keyboard starts at 500.
    await fireEvent(byID(fabric, 'pad'), 'layout', {
      layout: { x: 0, y: 200, width: 300, height: 400 },
    });
    await fireEvent(byID(fabric, 'pos'), 'layout', {
      layout: { x: 0, y: 200, width: 300, height: 400 },
    });
    listener({ height: 300, screenY: 500 });
    await wait(0);
    // 600 - (500 - 10) = 110
    assert.equal(byID(fabric, 'pad').props['paddingBottom'], 110);
    const inner = byID(fabric, 'pos').children[0]!;
    assert.equal(inner.props['bottom'], 100);
    assert.equal(inner.props['gap'], 4);

    listener({ height: 0 });
    await wait(0);
    // A removed prop travels to Fabric as null, which is how the fake records it.
    assert.equal(byID(fabric, 'pad').props['paddingBottom'], null);
  });

  it('keeps a shrunk height once its own frame reports the shrink', async () => {
    type Listener = (m: { height: number; screenY?: number }) => void;
    const listeners = new Set<Listener>();
    const { fabric } = await boot('Avoiding', {
      providers: [
        {
          provide: Keyboard.SOURCE,
          useValue: {
            subscribe: (fn: Listener) => (listeners.add(fn), () => listeners.delete(fn)),
            dismiss: () => {},
          },
        },
      ],
    });
    const shrink = byID(fabric, 'shrink');
    // Reaches the bottom of an 800pt screen; a 300pt keyboard starts at 500.
    await fireEvent(shrink, 'layout', { layout: { x: 0, y: 200, width: 300, height: 600 } });
    listeners.forEach((fn) => fn({ height: 300, screenY: 500 }));
    await wait(0);
    assert.equal(byID(fabric, 'shrink').props['height'], 300);

    // Native lays the view out at its new height and reports it. The view now ends exactly at
    // the keyboard's top, which is the point: the overlap it made room for must not read as
    // gone, or the height springs back under the keyboard.
    await fireEvent(byID(fabric, 'shrink'), 'layout', {
      layout: { x: 0, y: 200, width: 300, height: 300 },
    });
    await wait(0);
    assert.equal(byID(fabric, 'shrink').props['height'], 300);
  });
});

describe('virtual list', () => {
  it('offsets the window by the header and reports the end once', async () => {
    const { fabric, instance } = await boot<{
      ends: number[];
      list(): {
        scrollToIndex(o: { index: number; animated?: boolean }): void;
        window(): { index: number }[];
      };
    }>('Listing');
    const list = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(list, 'layout', { layout: { height: 100 } });
    await fireEvent(list.children[0]!.children[0]!, 'layout', { layout: { height: 50 } });

    // 50pt of header: scrolling to 150 puts row 10 at the top.
    await fireEvent(list, 'scroll', { contentOffset: { y: 150 } });
    assert.equal(instance.list().window()[0]!.index, 10);

    instance.list().scrollToIndex({ index: 20, animated: false });
    assert.deepEqual(fabric.commands.at(-1), {
      viewName: 'ScrollView',
      name: 'scrollTo',
      args: [0, 250, false],
    });

    // Content is 50 + 1000 (+ footer); within two viewports of the end fires once.
    await fireEvent(list, 'scroll', { contentOffset: { y: 800 } });
    assert.equal(instance.ends.length, 1, 'already, at one and a half viewports from the end');
    await fireEvent(list, 'scroll', { contentOffset: { y: 850 } });
    assert.equal(instance.ends.length, 1);
  });

  it('measures the end from the content size native reports, when it has one', async () => {
    const { fabric, instance } = await boot<{ ends: number[] }>('Listing');
    const list = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(list, 'layout', { layout: { height: 100 } });
    await fireEvent(list, 'contentSizeChange', { width: 300, height: 5000 });
    await fireEvent(list, 'scroll', { contentOffset: { y: 800 } });
    assert.deepEqual(instance.ends, [], 'four thousand points from the end native measured');
  });
});

describe('switch', () => {
  it("sends both platforms' spellings, including the ones Angular refuses to bind", async () => {
    const { fabric } = await boot('Switches');
    const node = flatten(fabric.committed).find((n) => n.viewName === 'Switch')!;
    const { nativeID: _id, ...props } = node.props;
    assert.deepEqual(props, {
      value: true,
      on: true,
      disabled: true,
      enabled: false,
      // `Switch.js` names its own role and announces its own disabled and checked state.
      accessibilityRole: 'switch',
      accessibilityState: { disabled: true, checked: true },
      thumbTintColor: '#fff',
      onTintColor: '#0f0',
      tintColor: '#000',
      trackColorForTrue: '#0f0',
      trackColorForFalse: '#000',
      trackTintColor: '#0f0',
      backgroundColor: '#333',
      borderRadius: 16,
    });
  });
});
