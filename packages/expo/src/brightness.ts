/**
 * `Brightness`, bound to `expo-brightness`.
 *
 * For the screens that have a reason to change it: a boarding pass, a QR code.
 *
 * The app's own brightness only. The system one is a global setting an app can leave changed
 * after it is gone, and needs a permission on Android - a decision to make deliberately against
 * Expo's own API rather than to reach through a convenience here.
 */
import {
  DestroyRef,
  InjectionToken,
  Service,
  inject,
  signal,
  type Signal,
  untracked,
  type WritableSignal,
} from '@angular/core';
import { TopClaim, onWindowFront, sharedBySource } from '@ng-native/device';
import { nativePlatform } from '@ng-native/fabric';
import { expoModule, present } from './native.ts';

export interface NativeBrightness {
  get(): Promise<number>;
  set(level: number): Promise<void>;
  restore(): Promise<void>;
  /** Calls `listener` when a window comes to the front, to be given the level again. */
  onWindowFront?(listener: () => void): () => void;
}

@Service()
export class Brightness {
  /** Overridden in a test to watch the level without changing a screen. */
  static readonly SOURCE = new InjectionToken<NativeBrightness | null>(
    'angular-native.brightnessSource',
    {
      factory: () => {
        const expo = expoModule(
          'expo-brightness',
          () => require('expo-brightness') as typeof import('expo-brightness'),
        );
        if (!expo) return null;
        // Missing from the build: the stand-in, to say so when it is used.
        if (!present(expo)) return expo as never;
        // One per module, so every app the runtime mounts sets the same screen.
        return sharedBySource(Brightness, expo, () => {
          if (nativePlatform() === 'android') {
            return {
              get: () => expo.getBrightnessAsync(),
              set: (level) => expo.setBrightnessAsync(level),
              restore: () => expo.restoreSystemBrightnessAsync(),
              onWindowFront,
            };
          }
          // iOS has no level of the app's own: `setBrightnessAsync` sets the screen's, which stays
          // after the app until the device locks, and `restoreSystemBrightnessAsync` does nothing
          // there. So the level the screen had before the first set is read, and set again. One
          // queue, so a set asked for while a restore runs reads that level after it is back.
          let before: number | null = null;
          let holding = false;
          let queue: Promise<unknown> = Promise.resolve();
          const inTurn = (step: () => Promise<void>): Promise<void> => {
            const turn = queue.then(step);
            queue = turn.catch(() => {});
            return turn;
          };
          return {
            get: () => expo.getBrightnessAsync(),
            set: (level) =>
              inTurn(async () => {
                if (!holding) {
                  before = await expo.getBrightnessAsync().catch(() => null);
                  holding = true;
                }
                await expo.setBrightnessAsync(level);
              }),
            restore: () =>
              inTurn(async () => {
                if (!holding) return;
                holding = false;
                if (before !== null) await expo.setBrightnessAsync(before);
              }),
            onWindowFront,
          };
        });
      },
    },
  );

  private readonly native = inject(Brightness.SOURCE);
  /** Every app's levels: the screen is the runtime's, not an app's. */
  private readonly window = sharedBySource(
    BrightnessWindow,
    this.native,
    () => new BrightnessWindow(this.native),
  );
  private readonly current = this.window.current;
  /** This app, among the apps setting the level. */
  private readonly owner = {};

  /** Nought to one. One until the platform answers, since that is what a screen already shows. */
  readonly level: Signal<number> = this.current.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      // An app that goes takes its levels with it, and leaves the screen to the apps still here.
      this.window.levels.claims.drop(this.owner);
      this.window.levels.apply();
    });
  }

  /**
   * Set it, and return the function that puts it back.
   *
   * Always paired, because the alternative is an app that leaves the screen at full brightness
   * after the boarding pass has been shown - which the user experiences as a battery fault.
   */
  set(level: number): () => void {
    const clamped = Math.min(1, Math.max(0, level));
    // A stack, as the status bar's is: a screen pushed over one that set a level of its own puts
    // back the level beneath it, not the system's, when it goes.
    const drop = this.window.levels.claims.push(this.owner, clamped);
    this.window.levels.apply();
    return () => {
      drop();
      this.window.levels.apply();
    };
  }

  restore(): void {
    // This app's levels are put back, so a release still to come has nothing left to undo. Another
    // app's stay: the screen is the runtime's.
    this.window.levels.claims.drop(this.owner);
    if (untracked(this.window.levels.claims.all).length > 0) {
      this.window.levels.apply();
      return;
    }
    this.window.levels.clear();
    this.window.restore();
  }
}

/** The screen's level, as every app on one module sets it. */
class BrightnessWindow {
  readonly current: WritableSignal<number> = signal(1);
  readonly levels: TopClaim<number>;
  private readonly native: NativeBrightness | null;

  constructor(native: NativeBrightness | null) {
    this.native = native;
    this.levels = new TopClaim(
      (level) => {
        this.current.set(level);
        void this.native?.set(level);
      },
      () => this.restore(),
      present(native)?.onWindowFront,
    );
    // What the screen shows, unless a level was set before the platform answered.
    void present(native)
      ?.get()
      .then(
        (level) => {
          if (untracked(this.levels.claims.all).length === 0) this.current.set(level);
        },
        () => {},
      );
  }

  restore(): void {
    const native = this.native;
    void native
      ?.restore()
      .then(() => native.get())
      .then(
        (level) => {
          // A level set while the restore ran is the one showing, not the one read back.
          if (untracked(this.levels.claims.all).length === 0) this.current.set(level);
        },
        () => {},
      );
  }
}
