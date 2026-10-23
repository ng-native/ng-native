/**
 * `provideNativeKeyboard()`: the keyboard's motion on Android from `@ng-native/expo`'s native half,
 * driven through a stand-in for the native module and for React Native's own events.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Injector } from '@angular/core';
import { KEYBOARD_MOTION, Keyboard, type KeyboardMetrics } from '@ng-native/device';
import {
  nativeKeyboardSource,
  provideNativeKeyboard,
  type NativeKeyboard,
  type NativeKeyboardChange,
  type NativeKeyboardFrame,
} from '@ng-native/expo/keyboard';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The native module and React Native's own events, each sent by hand. */
function fakes() {
  const changes = new Set<(change: NativeKeyboardChange) => void>();
  const frames = new Set<(frame: NativeKeyboardFrame) => void>();
  const native = {
    addListener(event: string, listener: (value: never) => void) {
      const set = (event === 'onKeyboardChange' ? changes : frames) as Set<unknown>;
      set.add(listener);
      return { remove: () => set.delete(listener) };
    },
  } as NativeKeyboard;
  const reactNative = new Set<(metrics: KeyboardMetrics) => void>();
  let dismissed = 0;
  const fallback = {
    subscribe: (listener: (metrics: KeyboardMetrics) => void) => {
      reactNative.add(listener);
      return () => reactNative.delete(listener);
    },
    dismiss: () => dismissed++,
  };
  return {
    source: nativeKeyboardSource(native, fallback),
    change: (change: NativeKeyboardChange) => changes.forEach((listener) => listener(change)),
    frame: (frame: NativeKeyboardFrame) => frames.forEach((listener) => listener(frame)),
    didShow: (metrics: KeyboardMetrics) => reactNative.forEach((listener) => listener(metrics)),
    listening: () => changes.size + frames.size + reactNative.size,
    dismissed: () => dismissed,
  };
}

describe('the native keyboard source', () => {
  it('reports the motion as it starts, with its duration and curve', () => {
    const { source, change } = fakes();
    const heard: KeyboardMetrics[] = [];
    source.subscribe((metrics) => heard.push(metrics));
    change({ height: 288, screenY: 578, duration: 285, easing: 'easeOut' });
    change({ height: 0, duration: 285, easing: 'easeOut' });
    assert.deepEqual(heard, [
      { height: 288, screenY: 578, duration: 285, easing: 'easeOut' },
      { height: 0, duration: 285, easing: 'easeOut' },
    ]);
  });

  it("drops React Native's own event that says what the motion did, sent just before it", async () => {
    const { source, change, didShow } = fakes();
    const heard: KeyboardMetrics[] = [];
    source.subscribe((metrics) => heard.push(metrics));
    didShow({ height: 288.38095092, screenY: 577.904785, duration: 0, easing: 'keyboard' });
    assert.equal(heard.length, 0, 'not reported before the motion it describes');
    change({ height: 288.3809523, screenY: 577.9047619, duration: 285, easing: 'easeOut' });
    await wait(150);
    assert.deepEqual(
      heard.map((metrics) => metrics.duration),
      [285],
      'only the motion, which overtakes it',
    );
  });

  it("drops React Native's own event that says what the motion did, sent just after it", async () => {
    const { source, change, didShow } = fakes();
    const heard: KeyboardMetrics[] = [];
    source.subscribe((metrics) => heard.push(metrics));
    change({ height: 288.3809523, screenY: 577.9047619, duration: 285, easing: 'easeOut' });
    didShow({ height: 288.38095092, screenY: 577.904785, duration: 0, easing: 'keyboard' });
    await wait(150);
    assert.deepEqual(
      heard.map((metrics) => metrics.duration),
      [285],
      'only the motion, though the two round the height differently',
    );
  });

  it("reports React Native's own event the motion does not cover, as a modal's keyboard", async () => {
    const { source, didShow } = fakes();
    const heard: KeyboardMetrics[] = [];
    source.subscribe((metrics) => heard.push(metrics));
    didShow({ height: 300, screenY: 560, duration: 0, easing: 'keyboard' });
    await wait(150);
    assert.deepEqual(heard, [{ height: 300, screenY: 560, duration: 0, easing: 'keyboard' }]);
  });

  it('reports every frame of the motion, and its end as none', () => {
    const { source, frame } = fakes();
    const heard: (KeyboardMetrics | null)[] = [];
    source.subscribeMotion!((at) => heard.push(at));
    frame({ height: 0 });
    frame({ height: 120, screenY: 746 });
    frame({ end: true });
    assert.deepEqual(heard, [{ height: 0 }, { height: 120, screenY: 746 }, null]);
  });

  it('lets go of every listener, and dismisses as React Native does', async () => {
    const { source, didShow, listening, dismissed } = fakes();
    const heard: KeyboardMetrics[] = [];
    const stop = source.subscribe((metrics) => heard.push(metrics));
    const stopMotion = source.subscribeMotion!(() => {});
    didShow({ height: 300 });
    stop();
    stopMotion();
    assert.equal(listening(), 0);
    await wait(150);
    assert.deepEqual(heard, [], 'and a report still waiting is dropped with it');
    source.dismiss();
    assert.equal(dismissed(), 1);
  });

  it("says the window starts where React Native's own source does, both reporting the screen", () => {
    // The module's screenY is from the top of the screen too, so a view React Native measures
    // from below the status bar is compared with it by the same allowance.
    const native = { addListener: () => ({ remove: () => {} }) } as NativeKeyboard;
    let windowTop = 34;
    const fallback = {
      subscribe: () => () => {},
      dismiss: () => {},
      get windowTop() {
        return windowTop;
      },
    };
    const source = nativeKeyboardSource(native, fallback);
    assert.equal(source.windowTop, 34);
    windowTop = 0;
    assert.equal(source.windowTop, 0, 'and follows it when the status bar changes');
  });
});

describe('provideNativeKeyboard', () => {
  it('provides nothing of its own off Android, as in Node', () => {
    const injector = Injector.create({ providers: provideNativeKeyboard() });
    assert.equal(injector.get(KEYBOARD_MOTION), null);
    assert.equal(injector.get(Keyboard.SOURCE).subscribeMotion, undefined);
  });
});
