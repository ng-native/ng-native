/**
 * `ScreenCapture`, bound to `expo-screen-capture`: keeping a screen out of screenshots and
 * recordings, and knowing when one was taken.
 *
 * ```ts
 * private readonly capture = inject(ScreenCapture);
 *
 * constructor() {
 *   void this.capture.prevent('card-details');
 *   inject(DestroyRef).onDestroy(() => void this.capture.allow('card-details'));
 * }
 * ```
 *
 * `prevent()` and `allow()` take a key, and capture stays prevented while any key is still held:
 * two screens that each prevent it do not undo each other. `screenshots` counts the screenshots
 * the user has taken, and the listener behind it lives as long as the app does and is removed
 * when the app is destroyed. Without the module installed, nothing is prevented and the count
 * stays at zero.
 */
import { DestroyRef, InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { expoModule } from './native.ts';
import { Permission, UNAVAILABLE } from './permissions.ts';

type Expo = typeof import('expo-screen-capture');

/** The module's functions this service calls. The real module is one; a test provides a fake. */
export type NativeScreenCapture = Pick<
  Expo,
  | 'isAvailableAsync'
  | 'preventScreenCaptureAsync'
  | 'allowScreenCaptureAsync'
  | 'enableAppSwitcherProtectionAsync'
  | 'disableAppSwitcherProtectionAsync'
  | 'addScreenshotListener'
  | 'getPermissionsAsync'
  | 'requestPermissionsAsync'
>;

@Service()
export class ScreenCapture {
  /** Overridden in a test to take screenshots nobody took. */
  static readonly SOURCE = new InjectionToken<NativeScreenCapture | null>(
    'angular-native.screenCaptureSource',
    {
      factory: () =>
        expoModule('expo-screen-capture', () => require('expo-screen-capture') as Expo),
    },
  );

  private readonly native = inject(ScreenCapture.SOURCE);
  private readonly count = signal(0);

  /**
   * The permission screenshot detection needs on Android 13 and earlier, where it reads the
   * photo library. Later Android needs none, and iOS always answers granted.
   */
  readonly permission: Permission = Permission.of(
    () => this.native?.getPermissionsAsync() ?? Promise.resolve(UNAVAILABLE),
    () => this.native?.requestPermissionsAsync() ?? Promise.resolve(UNAVAILABLE),
  );

  /** How many screenshots the user has taken while the app was in front. */
  readonly screenshots: Signal<number> = this.count.asReadonly();

  constructor() {
    const listener = this.native?.addScreenshotListener(() => this.count.update((n) => n + 1));
    if (listener) inject(DestroyRef).onDestroy(() => listener.remove());
  }

  /** Whether the platform can prevent capture. */
  async available(): Promise<boolean> {
    return (await this.native?.isAvailableAsync()) ?? false;
  }

  /**
   * Keeps the app out of screenshots and screen recordings until `allow()` is called with the same
   * key, or the app restarts. Omitting the key uses one shared default key.
   */
  async prevent(key?: string): Promise<void> {
    await this.native?.preventScreenCaptureAsync(key);
  }

  /** Releases the key; capture is allowed again once no key is held. */
  async allow(key?: string): Promise<void> {
    await this.native?.allowScreenCaptureAsync(key);
  }

  /**
   * iOS: blurs the app while it is not in focus - in the app switcher, in the background, and
   * during interruptions - by `blurIntensity` from 0 to 1, half by default. Android already hides
   * it in the app switcher while capture is prevented.
   */
  async protectAppSwitcher(blurIntensity?: number): Promise<void> {
    await this.native?.enableAppSwitcherProtectionAsync(blurIntensity);
  }

  async unprotectAppSwitcher(): Promise<void> {
    await this.native?.disableAppSwitcherProtectionAsync();
  }
}
