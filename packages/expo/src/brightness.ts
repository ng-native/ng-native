/**
 * `Brightness`, bound to `expo-brightness`.
 *
 * For the screens that have a reason to change it: a boarding pass, a QR code.
 *
 * The app's own brightness only. The system one is a global setting an app can leave changed
 * after it is gone, and needs a permission on Android - a decision to make deliberately against
 * Expo's own API rather than to reach through a convenience here.
 */
import { InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { expoModule, present } from './native.ts';

export interface NativeBrightness {
  get(): Promise<number>;
  set(level: number): Promise<void>;
  restore(): Promise<void>;
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
        return {
          get: () => expo.getBrightnessAsync(),
          set: (level) => expo.setBrightnessAsync(level),
          restore: () => expo.restoreSystemBrightnessAsync(),
        };
      },
    },
  );

  private readonly native = inject(Brightness.SOURCE);
  private readonly current = signal(1);

  /** Nought to one. One until the platform answers, since that is what a screen already shows. */
  readonly level: Signal<number> = this.current.asReadonly();

  constructor() {
    void present(this.native)
      ?.get()
      .then(
        (level) => this.current.set(level),
        () => {},
      );
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
    const entry = { level: clamped };
    this.levels.push(entry);
    this.apply(clamped);
    return () => {
      const at = this.levels.indexOf(entry);
      if (at === -1) return;
      this.levels.splice(at, 1);
      if (at < this.levels.length) return;
      const below = this.levels.at(-1);
      if (below) this.apply(below.level);
      else this.restore();
    };
  }

  /** Every level set and not yet put back, the one in force last. */
  private readonly levels: { readonly level: number }[] = [];

  private apply(level: number): void {
    this.current.set(level);
    void this.native?.set(level);
  }

  restore(): void {
    // Everything set so far is put back, so a release still to come has nothing left to undo.
    this.levels.length = 0;
    void this.native
      ?.restore()
      .then(() => this.native?.get().then((level) => this.current.set(level)));
  }
}
