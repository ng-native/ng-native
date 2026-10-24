/**
 * What the user has turned on in the system's accessibility settings.
 *
 * The components apply the defaults React Native's wrappers do - roles, labels, whether a view is
 * an element at all - without anything being injected. This is for the decisions those defaults
 * cannot make: not animating when the user asked for less motion, announcing something that
 * changed off screen, giving a screen reader a different affordance than a finger gets.
 *
 * Every value starts at its neutral setting and is corrected once the platform answers, because
 * React Native reports all three asynchronously. A first paint therefore assumes nothing is on.
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
import { reactNative } from './react-native.ts';

export interface AccessibilitySettings {
  readonly screenReader: boolean;
  readonly reduceMotion: boolean;
  readonly boldText: boolean;
  /**
   * The user's text size, as a multiplier of the default.
   *
   * Not an event: it is read at startup and again when the app comes back, because changing it
   * means leaving for Settings. Text scales natively without anything here, so this is for the
   * layouts that have to give way to it - a row height, a line clamp, an icon beside a label.
   */
  readonly fontScale: number;
}

export interface AccessibilitySource {
  current(): Promise<AccessibilitySettings>;
  subscribe(listener: (settings: Partial<AccessibilitySettings>) => void): () => void;
  announce(message: string): void;
}

export function accessibilitySource(): AccessibilitySource {
  const native = reactNative();
  if (!native) {
    return {
      current: () =>
        Promise.resolve({
          screenReader: false,
          reduceMotion: false,
          boldText: false,
          fontScale: 1,
        }),
      subscribe: () => () => {},
      announce: () => {},
    };
  }

  const info = native.AccessibilityInfo;
  // A read that fails is the neutral setting, so the other three still arrive.
  const read = async (ask: () => Promise<boolean>) => {
    try {
      return await ask();
    } catch {
      return false;
    }
  };
  return {
    current: async () => {
      const [screenReader, reduceMotion, boldText] = await Promise.all([
        read(() => info.isScreenReaderEnabled()),
        read(() => info.isReduceMotionEnabled()),
        read(() => info.isBoldTextEnabled()),
      ]);
      return { screenReader, reduceMotion, boldText, fontScale: native.PixelRatio.getFontScale() };
    },
    subscribe: (listener) => {
      const subscriptions = [
        info.addEventListener('screenReaderChanged', (screenReader) => listener({ screenReader })),
        info.addEventListener('reduceMotionChanged', (reduceMotion) => listener({ reduceMotion })),
        info.addEventListener('boldTextChanged', (boldText) => listener({ boldText })),
        // `fontScale` has no change event of its own - changing it means leaving for Settings -
        // so the app coming back to the foreground is what stands in for one.
        native.AppState.addEventListener('change', (state) => {
          if (state === 'active') listener({ fontScale: native.PixelRatio.getFontScale() });
        }),
      ];
      return () => subscriptions.forEach((subscription) => subscription.remove());
    },
    announce: (message) => info.announceForAccessibility(message),
  };
}

@Service()
export class Accessibility {
  /** Overridden in a test to turn a setting on. */
  static readonly SOURCE = new InjectionToken<AccessibilitySource>(
    'angular-native.accessibilitySource',
    { factory: accessibilitySource },
  );

  private readonly source = inject(Accessibility.SOURCE);
  private readonly settings = signal<AccessibilitySettings>({
    screenReader: false,
    reduceMotion: false,
    boldText: false,
    fontScale: 1,
  });

  /** VoiceOver or TalkBack is running. */
  readonly screenReader: Signal<boolean> = computed(() => this.settings().screenReader);
  /**
   * The user asked for less animation. `@media (prefers-reduced-motion: reduce)` reads the same
   * setting and is the better answer wherever the motion is styling rather than logic.
   */
  readonly reduceMotion: Signal<boolean> = computed(() => this.settings().reduceMotion);
  /** The system font is heavier, so hand-tuned weights may need to give way. */
  readonly boldText: Signal<boolean> = computed(() => this.settings().boldText);
  /**
   * How much larger the user has asked text to be. One is the default; the largest accessibility
   * sizes are past three, which is where a row built for one line stops working.
   */
  readonly fontScale: Signal<number> = computed(() => this.settings().fontScale);

  constructor() {
    let heard: Partial<AccessibilitySettings> = {};
    // A read that fails leaves the neutral settings, which the change events still correct.
    this.source.current().then(
      (settings) => this.settings.set({ ...settings, ...heard }),
      () => {},
    );
    const stop = this.source.subscribe((change) => {
      heard = { ...heard, ...change };
      this.settings.update((current) => ({ ...current, ...change }));
    });
    inject(DestroyRef).onDestroy(stop);
  }

  /**
   * Say something to a screen reader that no focus change would have said. A list that reordered,
   * a search that returned nothing: changes a sighted user sees and a screen reader would miss.
   */
  announce(message: string): void {
    this.source.announce(message);
  }
}
