/**
 * The software keyboard: where it is, and how long it takes to get there.
 *
 * On iOS the metrics change as the keyboard starts to move, with the duration and curve it is
 * moving on, so a layout can move with it. On Android React Native says only where the keyboard is
 * going, as it starts to move, with no duration, so a layout jumps there while the keyboard slides;
 * `@ng-native/expo`'s `provideNativeKeyboard()` adds the duration and curve. See `keyboardSource`.
 */
import {
  ApplicationRef,
  DestroyRef,
  InjectionToken,
  Service,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { HostEngine, nativePlatform, type HostNode } from '@ng-native/fabric';
import {
  edgeToEdgeFlag,
  reactNative,
  type NativeKeyboardEvent,
  type ReactNative,
} from './react-native.ts';

/** What the platform reports when the keyboard moves. */
export interface KeyboardMetrics {
  /** Height in dp; zero when the keyboard is hidden. */
  readonly height: number;
  /**
   * Where its top edge is, from the top of the screen. Absent when hidden. A view measured in the
   * window is compared with it less `Keyboard.windowTop`.
   */
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
  /**
   * How far below the top of the screen the window a view is measured in starts, in points, for
   * a source that knows it is not zero. Read when it is compared, as it changes with the status
   * bar. See `keyboardSource`.
   */
  readonly windowTop?: number;
  /**
   * How far below the top of the screen the app's window itself starts, in points, for a source
   * that can read it: the lower half of a split screen, or a freeform window, on Android. Read when
   * it is compared, as the window can move.
   */
  readonly screenTop?: number;
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
 * has landed, and a layout that waits for them moves after it, so they are heard only until the
first Will event, for a keyboard already moving when listening starts. `keyboardWillChangeFrame` covers a
 * keyboard that changes size while it is up - the predictive bar, another language's layout - and
 * is ignored while it is down: UIKit posts one beside every show and hide as well, and the one
 * beside a hide is the frame the keyboard leaves by, off the bottom of the screen.
 *
 * Android sends no Will events at all, so there it is the Did events. They arrive once the
 * window's insets have changed, which is as the keyboard starts to move rather than once it has
 * stopped, with a duration of zero: they say nothing of the motion.
 *
 * Both platforms report the keyboard's `screenY` from the top of the screen. iOS measures a view
 * from there too. Android measures it from below the status bar when React Native's edge-to-edge
 * flag is off, even in an app drawn under the bar, such as Expo Go, which leaves the flag off: its
 * `measureInWindow` leaves out the bar's inset then. `windowTop` is that inset, zero when the flag
 * is on, which a layout takes off `screenY` to compare the keyboard with a view it measured.
 */
export function keyboardSource(): KeyboardSource {
  const native = reactNative();
  if (!native) return { subscribe: () => () => {}, dismiss: () => {} };
  const { Keyboard: keyboard, Platform } = native;

  return {
    get windowTop() {
      return windowTopOf(native);
    },
    subscribe: (listener) => {
      // A keyboard already up says nothing until it next moves. `Keyboard.js` keeps the last show
      // it heard, from whenever React Native first loaded it.
      const shown = keyboard.metrics?.();
      const already = shown ? { height: shown.height, screenY: shown.screenY } : null;
      if (Platform?.OS !== 'ios') {
        const subscriptions = [
          keyboard.addListener('keyboardDidShow', (event) => listener(metricsOf(event))),
          keyboard.addListener('keyboardDidHide', () => listener({ height: 0 })),
        ];
        if (already) listener(already);
        return () => subscriptions.forEach((subscription) => subscription.remove());
      }
      let up = already !== null;
      // Started while the keyboard moves, the Will event is missed and `Keyboard.js` still holds
      // where it started from, so the Did event says where it landed. After a Will event, the
      // Will events say it all: a show a hide interrupts can land after the hide begins.
      let heard = false;
      const subscriptions = [
        keyboard.addListener('keyboardWillShow', (event) => {
          up = heard = true;
          listener(metricsOf(event));
        }),
        keyboard.addListener('keyboardWillChangeFrame', (event) => {
          if (up) listener(metricsOf(event));
        }),
        keyboard.addListener('keyboardWillHide', (event) => {
          up = false;
          heard = true;
          listener({ height: 0, ...timingOf(event) });
        }),
        keyboard.addListener('keyboardDidShow', (event) => {
          if (heard) return;
          up = true;
          listener({ height: event.endCoordinates.height, screenY: event.endCoordinates.screenY });
        }),
        keyboard.addListener('keyboardDidHide', () => {
          if (heard) return;
          up = false;
          listener({ height: 0 });
        }),
      ];
      if (already) listener(already);
      return () => subscriptions.forEach((subscription) => subscription.remove());
    },
    dismiss: () => keyboard.dismiss(),
  };
}

/**
 * Require React Native's `Keyboard.js` now, so it records each show and hide from here on.
 *
 * It keeps the last one it heard, which `keyboardSource` starts from, but only from when it is
 * first required. Left to the `Keyboard` service, that is when the first `text-input` appears, and
 * a keyboard the native header's search bar opened before then reads as down until it next moves.
 */
export function recordKeyboard(): void {
  const native = reactNative();
  if (native) void native.Keyboard;
}

/**
 * What React Native's Android `measureInWindow` leaves out above a view: the status bar's height,
 * unless its edge-to-edge flag is on. Zero on iOS.
 */
function windowTopOf(native: ReactNative): number {
  if (native.Platform?.OS !== 'android' || edgeToEdgeFlag(native)) return 0;
  // `StatusBar.currentHeight` is the bar's height when the app started. The module's own constant
  // is read from the window's current insets on each call, as the inset `measureInWindow` leaves
  // out is: after a rotation the two still agree.
  const manager = native.TurboModuleRegistry?.get('StatusBarManager') as
    { getConstants?(): { HEIGHT?: number } } | null | undefined;
  return manager?.getConstants?.().HEIGHT ?? native.StatusBar?.currentHeight ?? 0;
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
  private readonly engine = inject(HostEngine, { optional: true });
  private readonly app = inject(ApplicationRef, { optional: true });
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

  /**
   * How far below the top of the screen the window `measureInWindow` reports in starts: the status
   * bar's height on Android unless React Native's edge-to-edge flag is on, and zero otherwise. The
   * keyboard's top edge in that window is `screenY` less this. It changes with a rotation, so read
   * it when comparing rather than keeping it.
   *
   * On Android, read from where React Native measures the app's root, which is drawn from the top
   * of the screen: React Native takes the bar off its measurements as it lays the root out, and keeps
   * doing so when the bar is hidden or shown later, until the root is laid out again. The bar's
   * own height stands in where the root has not been measured.
   *
   * A window that itself starts below the top of the screen, in a split screen or freeform on
   * Android, adds its own top, where the source can read it: `provideNativeKeyboard()` from
   * `@ng-native/expo` can, and React Native alone cannot.
   */
  get windowTop(): number {
    return this.belowBar() + (this.source.screenTop ?? 0);
  }

  /** How far the window a view is measured in starts below the top of the app's own window. */
  private belowBar(): number {
    let top = this.source.windowTop ?? 0;
    // ponytail: the first root component is taken to start at the top of the app's window, as an
    // app's root does; a root placed lower would read as a window starting higher.
    const root = this.app?.components[0]?.location.nativeElement as HostNode | undefined;
    if (root && nativePlatform() === 'android')
      this.engine?.measure(root, (frame) => (top = -frame.y));
    return top;
  }

  /** Where the keyboard is now: at every frame of its motion where `followsMotion`. */
  readonly position: Signal<KeyboardMetrics> = computed(() => this.frame() ?? this.current());

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(this.source.subscribe((metrics) => this.current.set(metrics)));
    const stop = this.source.subscribeMotion?.((frame) => this.frame.set(frame));
    if (stop) destroyRef.onDestroy(stop);
  }

  /**
   * Put the keyboard away, as tapping outside a field would: the focused text field is sent
   * `blur`, as a scroll view does at such a tap. A focused view or button is left as it is.
   *
   * React Native's own `Keyboard.dismiss()`, which the source calls too, blurs only a field its
   * `TextInput` component recorded in `TextInputState`. A `text-input` here is the native component
   * with no `TextInput.js` around it, so nothing is recorded and that call alone blurs nothing.
   */
  dismiss(): void {
    this.engine?.blurFocused();
    this.source.dismiss();
  }
}
