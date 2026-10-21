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
 * two screens that each prevent it do not undo each other. Keys are the runtime's, as the window is:
 * an app that goes releases the keys it holds, and leaves those another app holds. `screenshots` counts the screenshots
 * the user has taken, and the listener behind it lives as long as the app does and is removed
 * when the app is destroyed. Without the module installed, nothing is prevented and the count
 * stays at zero.
 */
import { DestroyRef, InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { onWindowFront, sharedBySource } from '@ng-native/device';
import { expoModule, present } from './native.ts';
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
> & {
  /** Calls `listener` when a window comes to the front, to be kept out of capture again. */
  onWindowFront?(listener: () => void): () => void;
  /**
   * Prevents capture on the window now in front, past the module's own record of its keys, which
   * would send nothing for a key it already has.
   */
  preventAgain?(): Promise<void>;
};

/** The key `expo-screen-capture` uses when none is given. */
const DEFAULT_KEY = 'default';

@Service()
export class ScreenCapture {
  /** Overridden in a test to take screenshots nobody took. */
  static readonly SOURCE = new InjectionToken<NativeScreenCapture | null>(
    'angular-native.screenCaptureSource',
    {
      factory: () => {
        const expo = expoModule(
          'expo-screen-capture',
          () => require('expo-screen-capture') as Expo,
        );
        const loaded = present(expo);
        if (!loaded) return expo;
        // One per module, so every app the runtime mounts holds the same keys.
        return sharedBySource(ScreenCapture, loaded, () => ({
          ...loaded,
          onWindowFront,
          preventAgain: async () => {
            const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo
              ?.modules;
            const native = modules?.['ExpoScreenCapture'] as
              { preventScreenCapture?(): Promise<void> } | undefined;
            await native?.preventScreenCapture?.();
          },
        }));
      },
    },
  );

  private readonly native = inject(ScreenCapture.SOURCE);
  private readonly count = signal(0);
  /** Every app's keys: the window is the runtime's, not an app's. */
  private readonly window = sharedBySource(
    CaptureWindow,
    this.native,
    () => new CaptureWindow(this.native),
  );
  /** This app, among the apps holding keys. */
  private readonly owner = {};

  /**
   * The permission screenshot detection needs on Android 13 and earlier, where it reads the
   * photo library. Later Android needs none, and iOS always answers granted.
   */
  readonly permission: Permission = Permission.of(
    () => this.native?.getPermissionsAsync?.() ?? Promise.resolve(UNAVAILABLE),
    () => this.native?.requestPermissionsAsync?.() ?? Promise.resolve(UNAVAILABLE),
  );

  /** How many screenshots the user has taken while the app was in front. */
  readonly screenshots: Signal<number> = this.count.asReadonly();

  constructor() {
    const listener = present(this.native)?.addScreenshotListener(() =>
      this.count.update((n) => n + 1),
    );
    inject(DestroyRef).onDestroy(() => {
      listener?.remove();
      this.window.leave(this.owner);
    });
  }

  /** Whether the platform can prevent capture. */
  async available(): Promise<boolean> {
    return (await this.native?.isAvailableAsync()) ?? false;
  }

  /**
   * Keeps the app out of screenshots and screen recordings until `allow()` is called with the same
   * key, or the app goes. Omitting the key uses one shared default key.
   */
  async prevent(key?: string): Promise<void> {
    await this.window.prevent(this.owner, key);
  }

  /** Releases the key; capture is allowed again once no key is held. */
  async allow(key?: string): Promise<void> {
    await this.window.allow(this.owner, key);
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

/** Screen capture, as every app on one module holds it. */
class CaptureWindow {
  /** The apps holding each key. */
  private readonly holders = new Map<string, Set<object>>();
  private readonly native: NativeScreenCapture | null;

  constructor(native: NativeScreenCapture | null) {
    this.native = native;
    // Lives as long as the module, which is the runtime's.
    present(native)?.onWindowFront?.(() => {
      if (this.holders.size > 0) void this.native?.preventAgain?.().catch(() => {});
    });
  }

  async prevent(owner: object, key: string | undefined): Promise<void> {
    const name = key ?? DEFAULT_KEY;
    const holders = this.holders.get(name) ?? new Set();
    this.holders.set(name, holders.add(owner));
    await this.native?.preventScreenCaptureAsync(key);
  }

  async allow(owner: object, key: string | undefined): Promise<void> {
    const name = key ?? DEFAULT_KEY;
    const holders = this.holders.get(name);
    holders?.delete(owner);
    // Another app holding the key keeps it: the module would release it for both.
    if (holders && holders.size > 0) return;
    this.holders.delete(name);
    await this.native?.allowScreenCaptureAsync(key);
  }

  /** Releases `owner`'s keys, for an app that goes: those another app holds stay held. */
  leave(owner: object): void {
    for (const name of [...this.holders.keys()]) void this.allow(owner, name).catch(() => {});
  }
}
