/**
 * `Haptics`, bound to Expo's native module.
 *
 * Injected, not imported as functions: `inject(Haptics).impact()`. Nothing needs providing - the
 * source token carries its own factory, and a service nobody injects is never constructed.
 *
 * The native module is used directly rather than through `expo-haptics`'s JavaScript, which adds
 * one thing: a throw when the module is missing. Asking for it optionally answers the same
 * question without the throw, and sidesteps the enum its functions take. The package still has
 * to be installed - that is what links the native side.
 */
import { InjectionToken, Service, inject } from '@angular/core';
import { expoModule, optional, present } from './native.ts';

/** How hard the collision felt. `rigid` and `soft` are iOS 13+. */
export type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

/** What happened, rather than how it felt. iOS plays a distinct pattern for each. */
export type NotificationType = 'success' | 'warning' | 'error';

/** The slice of `expo-haptics` this needs. */
export interface NativeHaptics {
  impactAsync(style: ImpactStyle): Promise<void>;
  notificationAsync(type: NotificationType): Promise<void>;
  selectionAsync(): Promise<void>;
}

/**
 * Every method returns nothing and swallows failures.
 *
 * Expo's are all promises, and a caller who does not await one gets an unhandled rejection on a
 * device with no Taptic Engine, in a simulator, or on an Android build with vibration permission
 * off - none of which is a reason for anything to go wrong on screen. Nobody awaits a vibration.
 *
 * ponytail: silence means a broken haptic looks like a working one. If that ever needs
 * debugging, log under `__DEV__` rather than making callers handle a rejection.
 */
@Service()
export class Haptics {
  /** Overridden in a test to record feedback that never reaches a Taptic Engine. */
  static readonly SOURCE = new InjectionToken<NativeHaptics | null>(
    'angular-native.hapticsSource',
    {
      factory: () => {
        const core = optional(
          () => require('expo-modules-core') as typeof import('expo-modules-core'),
        );
        return expoModule('expo-haptics', () =>
          core?.requireOptionalNativeModule<NativeHaptics>('ExpoHaptics'),
        );
      },
    },
  );

  private readonly native = inject(Haptics.SOURCE);

  /** Whether the native module is installed at all. */
  get available(): boolean {
    return present(this.native) !== null;
  }

  /** A collision between interface elements. */
  impact(style: ImpactStyle = 'medium'): void {
    this.play(() => this.native?.impactAsync(style));
  }

  /** A task succeeded or failed. */
  notify(type: NotificationType): void {
    this.play(() => this.native?.notificationAsync(type));
  }

  /** A selection changed: the lightest of the three. */
  select(): void {
    this.play(() => this.native?.selectionAsync());
  }

  private play(feedback: () => Promise<void> | undefined): void {
    try {
      void feedback()?.catch(() => {});
    } catch {
      // A module that is present but not linked throws synchronously.
    }
  }
}
