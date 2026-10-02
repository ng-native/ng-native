/**
 * `Tracking`, bound to `expo-tracking-transparency`: Apple's App Tracking Transparency permission.
 *
 * ```ts
 * private readonly tracking = inject(Tracking);
 *
 * async startAnalytics(): Promise<void> {
 *   const allowed = await this.tracking.permission.ensure();
 *   this.analytics.start({ advertisingId: allowed ? this.tracking.advertisingId() : null });
 * }
 * ```
 *
 * iOS 14.5 and later ask before an app may track the user across other companies' apps and
 * websites, and hand out the advertising identifier only once the user has said yes. The question
 * is asked once: after an answer, the platform shows no dialog again, so `blocked()` is how an app
 * knows to offer Settings instead. Android and the web have no such permission, and the module
 * answers granted there. Without the module installed, the permission is refused and there is no
 * identifier.
 */
import { InjectionToken, Service, inject } from '@angular/core';
import { expoModule } from './native.ts';
import { Permission, UNAVAILABLE } from './permissions.ts';

type Expo = typeof import('expo-tracking-transparency');

/** The module's functions this service calls. The real module is one; a test provides a fake. */
export type NativeTracking = Pick<
  Expo,
  | 'getTrackingPermissionsAsync'
  | 'requestTrackingPermissionsAsync'
  | 'isAvailable'
  | 'getAdvertisingId'
>;

@Service()
export class Tracking {
  /** Overridden in a test to answer a tracking prompt nobody was shown. */
  static readonly SOURCE = new InjectionToken<NativeTracking | null>(
    'angular-native.trackingSource',
    {
      factory: () =>
        expoModule(
          'expo-tracking-transparency',
          () => require('expo-tracking-transparency') as Expo,
        ),
    },
  );

  private readonly native = inject(Tracking.SOURCE);

  /**
   * The permission to track. `ensure()` shows Apple's dialog only if it has not been answered;
   * the text in it is `NSUserTrackingUsageDescription`, set through the module's config plugin.
   */
  readonly permission: Permission = Permission.of(
    () => this.native?.getTrackingPermissionsAsync?.() ?? Promise.resolve(UNAVAILABLE),
    () => this.native?.requestTrackingPermissionsAsync?.() ?? Promise.resolve(UNAVAILABLE),
  );

  /** Whether the device has the tracking API. Where it does not, the permission answers granted. */
  get available(): boolean {
    return this.native?.isAvailable() ?? false;
  }

  /**
   * The advertising identifier: the IDFA on iOS, the advertising ID on Android. Null on iOS until
   * tracking is allowed, in the simulator, and on Android with ad tracking limited.
   */
  advertisingId(): string | null {
    return this.native?.getAdvertisingId() ?? null;
  }
}
