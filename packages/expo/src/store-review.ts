/**
 * `StoreReview`, bound to `expo-store-review`: the platform's "rate this app" prompt.
 *
 * ```ts
 * private readonly review = inject(StoreReview);
 *
 * async finishedFifthWorkout(): Promise<void> {
 *   if (await this.review.hasAction()) await this.review.request();
 * }
 * ```
 *
 * The module's own four functions under shorter names. The prompt is the platform's, and so is the
 * decision whether it appears at all: iOS shows it at most three times a year and says nothing
 * when it declines, so a call that resolves is not a prompt that was shown. Without the module
 * installed, every question answers no and `request()` does nothing.
 */
import { InjectionToken, Service, inject, type Signal } from '@angular/core';
import { expoModule, asked, present } from './native.ts';

type Expo = typeof import('expo-store-review');

/** The module's functions this service calls. The real module is one; a test provides a fake. */
export type NativeStoreReview = Pick<
  Expo,
  'isAvailableAsync' | 'hasAction' | 'requestReview' | 'storeUrl'
>;

@Service()
export class StoreReview {
  /** Overridden in a test to ask for a review nobody will be shown. */
  static readonly SOURCE = new InjectionToken<NativeStoreReview | null>(
    'angular-native.storeReviewSource',
    { factory: () => expoModule('expo-store-review', () => require('expo-store-review') as Expo) },
  );

  private readonly native = inject(StoreReview.SOURCE);

  /**
   * Whether the platform has an in-app review prompt: iOS, and Android with the Play Store. False
   * until it answers.
   */
  readonly available: Signal<boolean> = asked(() => present(this.native)?.isAvailableAsync())
    .answer;

  /**
   * Whether `request()` would do anything: show the prompt, or failing that open the store page
   * set as `ios.appStoreUrl` or `android.playStoreUrl` in the app config.
   */
  async hasAction(): Promise<boolean> {
    return (await this.native?.hasAction()) ?? false;
  }

  /**
   * Asks the platform to show the prompt, or opens the store page where there is none. Resolves
   * whether or not the platform chose to show anything.
   */
  async request(): Promise<void> {
    await this.native?.requestReview();
  }

  /** The app's store page from the app config, for a "rate us" link. Null when none is set. */
  storeUrl(): string | null {
    return this.native?.storeUrl() ?? null;
  }
}
