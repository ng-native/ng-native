/**
 * The software keyboard: where it is, and how long it takes to get there.
 *
 * On iOS the metrics change as the keyboard starts to move, with the duration and curve it is
 * moving on, so a layout can move with it. On Android React Native says only where the keyboard is
 * going, as it starts to move, with no duration, so a layout jumps there while the keyboard slides;
 * `@ng-native/expo`'s `provideNativeKeyboard()` adds the duration and curve. See `keyboardSource`.
 */
import {
  DestroyRef,
  InjectionToken,
  Service,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { reactNative, type NativeKeyboardEvent } from './react-native.ts';

/** What the platform reports when the keyboard moves. */
export interface KeyboardMetrics {
  /** Height in dp; zero when the keyboard is hidden. */
  readonly height: number;
  /** Where its top edge is, from the top of the screen. Absent when hidden. */
  readonly screenY?: number;
  /** How long its own animation takes, in ms, for anything moving with it. */
  readonly duration?: number;
  /**
   * The curve its own animation runs on, for anything moving with it to match: one of
   * `LayoutEasing`'s names. On iOS that is usually `'keyboard'`, the keyboard's own curve. React
   * Native's own events on Android carry `'keyboard'` with a duration of zero: they say where the
   * keyboard is going and nothing of how it gets there, so nothing should try to animate alongside
   * them. `provideNativeKeyboard()` reports Android's duration, with `'easeOut'`.
   */
  readonly easing?: string;
}

/** Where the metrics come from. A fake stands in for the platform in tests. */
export interface KeyboardSource {
  subscribe(listener: (metrics: KeyboardMetrics) => void): () => void;
  /**
   * Where the keyboard is at each frame of its motion, for a source that knows: before the motion
   * starts, at every frame of it, and null once it is over. One that does not has no such method.
   */
  subscribeMotion?(listener: (frame: KeyboardMetrics | null) => void): () => void;
  dismiss(): void;
}

/** The timing a keyboard event carries, when it carries any. */
function timingOf(event: NativeKeyboardEvent): Pick<KeyboardMetrics, 'duration' | 'easing'> {
  if (event.duration === undefined) return {};
  return { duration: event.duration, easing: event.easing };
}

const metricsOf = (event: NativeKeyboardEvent): KeyboardMetrics => ({
  height: event.endCoordinates.height,
  screenY: event.endCoordinates.screenY,
  ...timingOf(event),
});

/**
 * The events RN's own KeyboardAvoidingView listens for, which differ by platform.
 *
 * On iOS the Will events: they arrive as the keyboard starts to move, carrying its duration and
 * curve, so a layout configured from them moves with the keyboard. The Did events arrive once it
 * has landed, and a layout that waits for them moves after it. `keyboardWillChangeFrame` covers a
 * keyboard that changes size while it is up - the predictive bar, another language's layout - and
 * is ignored while it is down: UIKit posts one beside every show and hide as well, and the one
 * beside a hide is the frame the keyboard leaves by, off the bottom of the screen.
 *
 * Android sends no Will events at all, so there it is the Did events. They arrive once the
 * window's insets have changed, which is as the keyboard starts to move rather than once it has
 * stopped, with a duration of zero: they say nothing of the motion.
 */
export function keyboardSource(): KeyboardSource {
  const native = reactNative();
  if (!native) return { subscribe: () => () => {}, dismiss: () => {} };
  const { Keyboard: keyboard, Platform } = native;

  return {
    subscribe: (listener) => {
      if (Platform?.OS !== 'ios') {
        const subscriptions = [
          keyboard.addListener('keyboardDidShow', (event) => listener(metricsOf(event))),
          keyboard.addListener('keyboardDidHide', () => listener({ height: 0 })),
        ];
        return () => subscriptions.forEach((subscription) => subscription.remove());
      }
      let up = false;
      const subscriptions = [
        keyboard.addListener('keyboardWillShow', (event) => {
          up = true;
          listener(metricsOf(event));
        }),
        keyboard.addListener('keyboardWillChangeFrame', (event) => {
          if (up) listener(metricsOf(event));
        }),
        keyboard.addListener('keyboardWillHide', (event) => {
          up = false;
          listener({ height: 0, ...timingOf(event) });
        }),
      ];
      return () => subscriptions.forEach((subscription) => subscription.remove());
    },
    dismiss: () => keyboard.dismiss(),
  };
}

/**
 * A native view that reports the keyboard's motion frame by frame, for a view to follow it on the
 * native side: a `<keyboard-dock>` on Android, where React Native says only where the keyboard
 * is going. `@ng-native/expo`'s `provideNativeKeyboard()` provides one; without it this is null.
 *
 * The view sends `onKeyboardMoveStart`, `onKeyboardMove` and `onKeyboardMoveEnd`, each with the
 * `height` of the keyboard over the view's own bottom edge, in points, and is laid out over the
 * element it reports for.
 */
export interface KeyboardMotion {
  /** The Fabric name of the view. */
  readonly viewName: string;
}

export const KEYBOARD_MOTION = new InjectionToken<KeyboardMotion | null>(
  'angular-native.keyboardMotion',
  { providedIn: 'root', factory: () => null },
);

/**
 * Subscribed for the life of the app, which is the life of the service, and removed when the app
 * is destroyed. A component that mounts mid-gesture wants the height that is already true rather
 * than the next change, which is why the subscription is the service's and not the component's.
 */
@Service()
export class Keyboard {
  /**
   * Where the metrics actually come from. Overriding this token is how a test drives the keyboard,
   * and it is finer than replacing the service: the code under test stays the real thing.
   */
  static readonly SOURCE = new InjectionToken<KeyboardSource>('angular-native.keyboardSource', {
    factory: keyboardSource,
  });

  private readonly source = inject(Keyboard.SOURCE);
  private readonly current = signal<KeyboardMetrics>({ height: 0 });
  private readonly frame = signal<KeyboardMetrics | null>(null);

  /**
   * Everything the platform said, for a layout that needs the animation duration too. It changes
   * as the keyboard starts to move, to where the keyboard is going.
   */
  readonly metrics: Signal<KeyboardMetrics> = this.current.asReadonly();
  readonly height = computed(() => this.current().height);
  readonly visible = computed(() => this.current().height > 0);

  /**
   * Whether `position` follows the keyboard frame by frame: on Android with `@ng-native/expo`'s
   * `provideNativeKeyboard()`, where a layout cannot animate alongside the keyboard and has to
   * move with it instead. Elsewhere it is `metrics`, and a layout animates to where that says.
   */
  readonly followsMotion = this.source.subscribeMotion !== undefined;

  /** Where the keyboard is now: at every frame of its motion where `followsMotion`. */
  readonly position: Signal<KeyboardMetrics> = computed(() => this.frame() ?? this.current());

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(this.source.subscribe((metrics) => this.current.set(metrics)));
    const stop = this.source.subscribeMotion?.((frame) => this.frame.set(frame));
    if (stop) destroyRef.onDestroy(stop);
  }

  /** Put the keyboard away, as tapping outside a field would. */
  dismiss(): void {
    this.source.dismiss();
  }
}
