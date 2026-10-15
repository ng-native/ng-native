/**
 * The software keyboard: where it is, and how long it takes to get there.
 *
 * On iOS the metrics change as the keyboard starts to move, with the duration and curve it is
 * moving on, so a layout can move with it; on Android, once it has arrived. See `keyboardSource`.
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
import { HostEngine } from '@ng-native/fabric';
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
   * `LayoutEasing`'s names. On iOS that is usually `'keyboard'`, the keyboard's own curve. On
   * Android it is always `'keyboard'` paired with a duration of zero: the platform animates its
   * own keyboard, the event arrives once it has, and nothing here should try to animate alongside
   * it.
   */
  readonly easing?: string;
}

/** Where the metrics come from. A fake stands in for the platform in tests. */
export interface KeyboardSource {
  subscribe(listener: (metrics: KeyboardMetrics) => void): () => void;
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
 * Android sends no Will events at all, so there it is the Did events, which arrive with a
 * duration of zero because the platform animates its own keyboard.
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
  private readonly current = signal<KeyboardMetrics>({ height: 0 });

  /** Everything the platform said, for a layout that needs the animation duration too. */
  readonly metrics: Signal<KeyboardMetrics> = this.current.asReadonly();
  readonly height = computed(() => this.current().height);
  readonly visible = computed(() => this.current().height > 0);

  constructor() {
    inject(DestroyRef).onDestroy(this.source.subscribe((metrics) => this.current.set(metrics)));
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
