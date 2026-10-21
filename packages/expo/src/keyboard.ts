/**
 * `provideNativeKeyboard()`: the keyboard's motion on Android, from this package's native half.
 *
 * React Native on Android reports the keyboard once the window's insets have changed, as it starts
 * to move, with no duration: a `<keyboard-avoiding-view>` jumps to where the keyboard is going and a
 * `<keyboard-dock>` jumps onto it, while the keyboard slides up underneath. iOS reports the motion
 * as it starts, with its duration and curve, and the same layouts move with the keyboard there.
 *
 * With this, Android does too. The `Keyboard` service hears of the motion as it starts, with
 * Android's duration, and its `position` follows every frame of it, which a
 * `<keyboard-avoiding-view>` moves with, since Android animates no layout alongside the keyboard by
 * default; and a `<keyboard-dock>` follows it frame by frame on the native side, as one does on iOS
 * with react-native-keyboard-controller. Off
 * Android, and in a build without this package's native half, such as Expo Go, it provides nothing
 * and React Native's own events are what there is.
 *
 * ```ts
 * bootstrap(App, { providers: [provideNativeKeyboard()] });
 * ```
 */
import { type Provider } from '@angular/core';
import {
  KEYBOARD_MOTION,
  Keyboard,
  keyboardSource,
  type KeyboardMetrics,
  type KeyboardSource,
} from '@ng-native/device';
import { currentPlatform } from './native.ts';
import { expoViewName } from './register-expo-view.ts';

const MODULE = 'NgNativeKeyboard';

/** What the native module sends as the keyboard starts to move. */
export interface NativeKeyboardChange {
  /** Points above the system bars; zero for a keyboard going away. */
  readonly height: number;
  /** The keyboard's top edge on the screen, in points. Absent for a keyboard going away. */
  readonly screenY?: number;
  readonly duration: number;
  readonly easing: string;
}

/** Where the keyboard is at one frame of its motion, or that the motion is over. */
export type NativeKeyboardFrame =
  { readonly height: number; readonly screenY?: number } | { readonly end: true };

/** This package's native keyboard module. A test provides a stand-in. */
export interface NativeKeyboard {
  addListener(
    event: 'onKeyboardChange',
    listener: (change: NativeKeyboardChange) => void,
  ): { remove(): void };
  addListener(
    event: 'onKeyboardMove',
    listener: (frame: NativeKeyboardFrame) => void,
  ): { remove(): void };
}

/** How long React Native's own event waits for the native one that says the same, in ms. */
const OVERTAKEN_MS = 100;

/** Heights closer than this, in points, are one: the two report it through different roundings. */
const SAME_HEIGHT = 0.5;

/** The module where the build has it, on Android. */
function nativeKeyboard(): NativeKeyboard | null {
  if (currentPlatform() !== 'android') return null;
  return (
    (globalThis as { expo?: { modules?: Record<string, NativeKeyboard | undefined> } }).expo
      ?.modules?.[MODULE] ?? null
  );
}

/** A native height or edge as the metrics carry it: only the fields that are there. */
const metricsOf = (at: {
  readonly height: number;
  readonly screenY?: number;
}): KeyboardMetrics => ({
  height: at.height,
  ...(at.screenY !== undefined && { screenY: at.screenY }),
});

/**
 * The keyboard as the native module reports it, as it starts to move and at every frame of the
 * motion, and as React Native's own events report it: they still come, and they are what a window
 * of its own, a modal's, has. They arrive at about the moment the native one does, sometimes just
 * before it, so one waits a moment and is dropped when the native one says the same; reported
 * first, it would hand a layout following the frames the destination before the motion began.
 */
export function nativeKeyboardSource(
  native: NativeKeyboard,
  fallback: KeyboardSource = keyboardSource(),
): KeyboardSource {
  return {
    subscribe: (listener) => {
      let last: number | null = null;
      let waiting: ReturnType<typeof setTimeout> | undefined;
      const report = (metrics: KeyboardMetrics) => {
        last = metrics.height;
        listener(metrics);
      };
      const subscription = native.addListener('onKeyboardChange', (change) => {
        clearTimeout(waiting);
        report({ ...metricsOf(change), duration: change.duration, easing: change.easing });
      });
      const stop = fallback.subscribe((metrics) => {
        clearTimeout(waiting);
        waiting = setTimeout(() => {
          if (last === null || Math.abs(metrics.height - last) >= SAME_HEIGHT) report(metrics);
        }, OVERTAKEN_MS);
      });
      return () => {
        clearTimeout(waiting);
        subscription.remove();
        stop();
      };
    },
    subscribeMotion: (listener) => {
      const subscription = native.addListener('onKeyboardMove', (frame) =>
        listener('end' in frame ? null : metricsOf(frame)),
      );
      return () => subscription.remove();
    },
    dismiss: () => fallback.dismiss(),
  };
}

/**
 * Follow the keyboard on Android as it moves rather than once it has: see this file. Nothing to
 * install beyond this package; a build made before it had this native module, and Expo Go, keep
 * React Native's own events.
 */
export function provideNativeKeyboard(): Provider[] {
  return [
    {
      provide: Keyboard.SOURCE,
      useFactory: () => {
        const native = nativeKeyboard();
        return native ? nativeKeyboardSource(native) : keyboardSource();
      },
    },
    {
      provide: KEYBOARD_MOTION,
      useFactory: () => (nativeKeyboard() ? { viewName: expoViewName(MODULE) } : null),
    },
  ];
}
