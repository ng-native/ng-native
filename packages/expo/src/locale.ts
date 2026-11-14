/**
 * `Locale`, bound to `expo-localization`.
 *
 * Both getters are synchronous, so unlike the other device services there is no default to sit at.
 * What makes this worth a service is that the answers *change*: a user can switch language in
 * Settings and come back, and a date that was formatted correctly is then wrong. The module's
 * hooks subscribe to that; nothing else does.
 *
 * The list is ordered by preference and always has at least one entry, which is the whole reason
 * to prefer it over a single locale string: an app that supports the user's second language should
 * use it rather than fall back to English.
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
import { expoModule, optional, presence } from './native.ts';

/** The subset worth naming. The module's own `Locale` carries the rest and is passed through. */
export interface LocaleLike {
  readonly languageTag: string;
  readonly languageCode: string | null;
  readonly regionCode: string | null;
  readonly textDirection: 'ltr' | 'rtl';
  readonly measurementSystem: 'metric' | 'us' | 'uk' | null;
}

export interface CalendarLike {
  readonly calendar: string | null;
  readonly timeZone: string | null;
  readonly uses24hourClock: boolean | null;
  readonly firstWeekday: number | null;
}

export interface NativeLocale {
  locales(): readonly LocaleLike[];
  calendars(): readonly CalendarLike[];
  onChange(listener: () => void): () => void;
}

@Service()
export class Locale {
  /** Overridden in a test to switch language without Settings. */
  static readonly SOURCE = new InjectionToken<NativeLocale | null>('angular-native.localeSource', {
    factory: () => {
      const expo = expoModule(
        'expo-localization',
        () => require('expo-localization') as typeof import('expo-localization'),
      );
      const rn = optional(() => require('react-native') as typeof import('react-native'));
      if (!expo) return null;

      return {
        locales: () => expo.getLocales(),
        calendars: () => expo.getCalendars(),
        /**
         * Re-read when the app comes back to the front.
         *
         * The module has listeners for this but does not export them, and changing a language or
         * a calendar means going to Settings - so returning to the app is exactly when the answer
         * can have changed, and is a public API rather than a path into someone's build directory.
         */
        onChange: (listener) => {
          const subscription = rn?.AppState.addEventListener('change', (state) => {
            if (state === 'active') listener();
          });
          return () => subscription?.remove();
        },
      };
    },
  });

  private readonly native = inject(Locale.SOURCE);

  /** Whether the module is here. False where the service is absent, and every call is inert. */
  readonly available: Signal<boolean> = presence(this.native);
  private readonly generation = signal(0);

  constructor() {
    const stop = this.native?.onChange(() => this.generation.update((n) => n + 1));
    if (stop) inject(DestroyRef).onDestroy(stop);
  }

  /** Most preferred first, always at least one. */
  readonly locales: Signal<readonly LocaleLike[]> = computed(() => {
    this.generation();
    return this.native?.locales() ?? [];
  });

  readonly calendars: Signal<readonly CalendarLike[]> = computed(() => {
    this.generation();
    return this.native?.calendars() ?? [];
  });

  /** The one to format with. */
  readonly locale: Signal<LocaleLike | null> = computed(() => this.locales()[0] ?? null);

  /** `rtl` is a layout decision, not a translation one, and is why this is worth a signal. */
  readonly rtl: Signal<boolean> = computed(() => this.locale()?.textDirection === 'rtl');

  /** The tag `Intl` wants. Undefined rather than a guess when nothing has been reported. */
  readonly tag: Signal<string | undefined> = computed(() => this.locale()?.languageTag);
}
