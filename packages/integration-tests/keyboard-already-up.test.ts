/**
 * A keyboard opened before anything asked the `Keyboard` service, such as by the native header's
 * search bar on a screen with no `text-input` yet.
 *
 * React Native's `Keyboard.js` keeps the last show and hide it heard, but only from when it is
 * first required. `watchConditions` runs at startup, so it is what requires it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Injector } from '@angular/core';
import { Keyboard, keyboardSource, watchConditions } from '@ng-native/device';

type Handler = (event: unknown) => void;

/**
 * A fake `react-native` whose `Keyboard` is created on first read, as React Native's lazy export
 * is, and from then on records shows and hides as `Keyboard.js` does.
 */
function lazyKeyboardNative(os: string) {
  const listeners = new Map<string, Set<Handler>>();
  const emit = (event: string, payload: unknown) =>
    [...(listeners.get(event) ?? [])].forEach((handler) => handler(payload));
  const subscription = { remove: () => {} };
  let keyboard: unknown;
  const native = {
    Platform: { OS: os },
    get Keyboard() {
      if (keyboard) return keyboard;
      let showing: { height: number; screenY: number } | null = null;
      const addListener = (event: string, handler: Handler) => {
        const set = listeners.get(event) ?? new Set<Handler>();
        set.add(handler);
        listeners.set(event, set);
        return { remove: () => set.delete(handler) };
      };
      addListener('keyboardDidShow', (event) => {
        showing = (event as { endCoordinates: { height: number; screenY: number } }).endCoordinates;
      });
      addListener('keyboardDidHide', () => (showing = null));
      keyboard = { addListener, dismiss: () => {}, metrics: () => showing };
      return keyboard;
    },
    AccessibilityInfo: {
      isScreenReaderEnabled: () => Promise.resolve(false),
      isReduceMotionEnabled: () => Promise.resolve(false),
      isBoldTextEnabled: () => Promise.resolve(false),
      addEventListener: () => subscription,
    },
    AppState: { currentState: 'active', addEventListener: () => subscription },
    Appearance: { getColorScheme: () => 'light', addChangeListener: () => subscription },
    Dimensions: { get: () => ({ width: 390, height: 844 }), addEventListener: () => subscription },
    I18nManager: { isRTL: false },
    PixelRatio: { get: () => 3, getFontScale: () => 1 },
  };
  return { native, emit };
}

/** The height a `Keyboard` service reads when it starts after a keyboard opened, on `os`. */
function heightAfterAnEarlyShow(os: string): number {
  const { native, emit } = lazyKeyboardNative(os);
  const engine = {
    root: 'root',
    updateConditions: () => {},
    addClass: () => {},
    removeClass: () => {},
  };
  const host = globalThis as Record<string, unknown>;
  host['require'] = (id: string) => (id === 'react-native' ? native : undefined);
  host['nativeFabricUIManager'] = {};
  let stop = () => {};
  try {
    stop = watchConditions(engine);
    // The search bar's keyboard opens: React Native sends Did events on both platforms.
    emit('keyboardDidShow', { endCoordinates: { height: 335, screenY: 456 } });
    const keyboard = Injector.create({
      providers: [
        { provide: Keyboard.SOURCE, useFactory: keyboardSource, deps: [] },
        { provide: Keyboard, deps: [] },
      ],
    }).get(Keyboard);
    return keyboard.height();
  } finally {
    stop();
    delete host['require'];
    delete host['nativeFabricUIManager'];
  }
}

describe('a keyboard opened before the Keyboard service started', () => {
  for (const os of ['ios', 'android']) {
    it(`gives the service its height at once on ${os}`, () => {
      assert.equal(heightAfterAnEarlyShow(os), 335);
    });
  }
});
