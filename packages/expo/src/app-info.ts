/**
 * `AppInfo`, bound to `expo-application` and `expo-device`: the app's version and build, and the
 * device it is running on.
 *
 * ```ts
 * protected readonly info = inject(AppInfo);
 * // {{ info.version }} ({{ info.build }}) on {{ info.device.model }}
 * ```
 *
 * Constants, read once, rather than signals: none of them changes while the app runs. Anything the
 * platform does not say is null, and so is everything from a module that is not installed.
 */
import { InjectionToken, Service, inject } from '@angular/core';
import { expoModule } from './native.ts';

export type DeviceKind = 'phone' | 'tablet' | 'desktop' | 'tv' | 'unknown';

/** Expo's `DeviceType` enum, whose values are these numbers. */
const KINDS: Record<number, DeviceKind> = {
  0: 'unknown',
  1: 'phone',
  2: 'tablet',
  3: 'desktop',
  4: 'tv',
};

/** The constants this reads, from each module. */
export interface NativeAppInfo {
  readonly application: {
    readonly nativeApplicationVersion: string | null;
    readonly nativeBuildVersion: string | null;
    readonly applicationId: string | null;
    readonly applicationName: string | null;
  } | null;
  readonly device: {
    readonly modelName: string | null;
    readonly brand: string | null;
    readonly osName: string | null;
    readonly osVersion: string | null;
    readonly isDevice: boolean;
    readonly deviceType: number | null;
  } | null;
}

@Service()
export class AppInfo {
  /** Overridden in a test to be any app on any phone. */
  static readonly SOURCE = new InjectionToken<NativeAppInfo>('angular-native.appInfoSource', {
    factory: () => ({
      application: expoModule(
        'expo-application',
        () => require('expo-application') as NonNullable<NativeAppInfo['application']>,
      ),
      device: expoModule(
        'expo-device',
        () => require('expo-device') as NonNullable<NativeAppInfo['device']>,
      ),
    }),
  });

  private readonly native = inject(AppInfo.SOURCE);

  /** The version people see: `CFBundleShortVersionString`, or Android's `versionName`. */
  // Read when asked, so a module missing from the build says so then, not as the service is made.
  get version(): string | null {
    return this.native.application?.nativeApplicationVersion ?? null;
  }
  /** The build number: `CFBundleVersion`, or Android's `versionCode`. */
  get build(): string | null {
    return this.native.application?.nativeBuildVersion ?? null;
  }
  /** The bundle identifier on iOS, the package name on Android. */
  get id(): string | null {
    return this.native.application?.applicationId ?? null;
  }
  /** The name under the icon. */
  get name(): string | null {
    return this.native.application?.applicationName ?? null;
  }

  get device(): ReturnType<typeof deviceOf> {
    return (this.deviceInfo ??= deviceOf(this.native.device));
  }
  private deviceInfo?: ReturnType<typeof deviceOf>;
}

/** What a device reads as without `expo-device`: nothing known. */
const UNKNOWN_DEVICE = {
  modelName: null,
  brand: null,
  osName: null,
  osVersion: null,
  isDevice: null,
  deviceType: null,
};

function deviceOf(native: NativeAppInfo['device']) {
  const device = native ?? UNKNOWN_DEVICE;
  return {
    /** `iPhone 17 Pro`, `Pixel 9`. */
    model: device.modelName,
    brand: device.brand,
    /** `iOS`, `iPadOS`, `Android`. */
    os: device.osName,
    osVersion: device.osVersion,
    /** False in a simulator or emulator. */
    physical: device.isDevice,
    type: device.deviceType === null ? null : (KINDS[device.deviceType] ?? 'unknown'),
  } as const;
}
