/**
 * `Location`, bound to `expo-location`.
 *
 * ```ts
 * private readonly location = inject(Location);
 * protected readonly here = this.location.position;
 *
 * const stop = await this.location.start({ accuracy: 'high', distance: 10 });
 * ```
 *
 * A `position` signal, which a one-off `current()` and a running `start()` both write to. Nothing
 * is watched until `start`, and the accuracy is explicit, for the same reason a sensor's interval
 * is: GPS at navigation accuracy is a battery the user notices. Both ask for the foreground
 * permission first, and do nothing without it.
 */
import { InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { expoModule } from './native.ts';
import { Permission, UNAVAILABLE, type PermissionResponse } from './permissions.ts';

/** How precise, in Expo's order: `lowest` is kilometres, `navigation` is metres and a hot GPS. */
export type LocationAccuracy = 'lowest' | 'low' | 'balanced' | 'high' | 'highest' | 'navigation';

/** Expo's `LocationAccuracy` enum, whose values are these numbers. */
const ACCURACY: Record<LocationAccuracy, number> = {
  lowest: 1,
  low: 2,
  balanced: 3,
  high: 4,
  highest: 5,
  navigation: 6,
};

export interface Position {
  readonly latitude: number;
  readonly longitude: number;
  /** Metres above sea level, where the platform knows. */
  readonly altitude: number | null;
  /** The radius, in metres, the fix is good to. */
  readonly accuracy: number | null;
  /** Degrees from true north, while moving. */
  readonly heading: number | null;
  /** Metres per second. */
  readonly speed: number | null;
  readonly timestamp: number;
}

export interface WatchOptions {
  readonly accuracy?: LocationAccuracy;
  /** Metres moved before the next update. */
  readonly distance?: number;
  /** Milliseconds between updates. Android only; iOS updates on distance. */
  readonly interval?: number;
}

type ExpoFix = import('expo-location').LocationObject;
/** A point on the map: what an address geocodes to, and what `reverseGeocode` takes. */
export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/** A place as the platform's geocoder names it: street, city, region, country and the rest. */
export type Address = import('expo-location').LocationGeocodedAddress;

type ExpoOptions = import('expo-location').LocationOptions;

/** The slice of `expo-location` this needs. */
export interface NativeLocation {
  getForegroundPermissionsAsync(): Promise<PermissionResponse>;
  requestForegroundPermissionsAsync(): Promise<PermissionResponse>;
  getCurrentPositionAsync(options?: ExpoOptions): Promise<ExpoFix>;
  watchPositionAsync(
    options: ExpoOptions,
    callback: (fix: ExpoFix) => void,
  ): Promise<{ remove(): void }>;
  geocodeAsync?(address: string): Promise<readonly Coordinates[]>;
  reverseGeocodeAsync?(coordinates: Coordinates): Promise<readonly Address[]>;
}

@Service()
export class Location {
  /** Overridden in a test to be somewhere without a GPS. */
  static readonly SOURCE = new InjectionToken<NativeLocation | null>(
    'angular-native.locationSource',
    {
      factory: () =>
        expoModule('expo-location', () => require('expo-location') as NativeLocation) ?? null,
    },
  );

  private readonly native = inject(Location.SOURCE);
  private readonly latest = signal<Position | null>(null);

  /** The foreground permission, which `current()` and `start()` ask for themselves. */
  readonly permission = Permission.of(
    () => this.native?.getForegroundPermissionsAsync?.() ?? Promise.resolve(UNAVAILABLE),
    () => this.native?.requestForegroundPermissionsAsync?.() ?? Promise.resolve(UNAVAILABLE),
  );

  /** The last position read, or null before the first. */
  readonly position: Signal<Position | null> = this.latest.asReadonly();

  /** Read the position once. Null without the permission or the module. */
  async current(accuracy: LocationAccuracy = 'balanced'): Promise<Position | null> {
    if (!this.native || !(await this.permission.ensure())) return null;
    const fix = await this.native.getCurrentPositionAsync({ accuracy: ACCURACY[accuracy] });
    this.latest.set(positionOf(fix));
    return this.latest();
  }

  /**
   * The places an address could be, best match first, from the platform's own geocoder. Empty
   * for an address it does not know, without the permission, and where the source has no
   * geocoder, as off a device. An app built without `expo-location` throws `MissingModuleError`.
   */
  async geocode(address: string): Promise<Coordinates[]> {
    if (!this.native?.geocodeAsync || !(await this.permission.ensure())) return [];
    const found = await this.native.geocodeAsync(address);
    return found.map(({ latitude, longitude }) => ({ latitude, longitude }));
  }

  /** The addresses at a point. Empty, and throwing, where `geocode` is. */
  async reverseGeocode(coordinates: Coordinates): Promise<Address[]> {
    if (!this.native?.reverseGeocodeAsync || !(await this.permission.ensure())) return [];
    const { latitude, longitude } = coordinates;
    return [...(await this.native.reverseGeocodeAsync({ latitude, longitude }))];
  }

  /** Follow the position into the signal. Resolves to the function that stops. */
  async start(options: WatchOptions = {}): Promise<() => void> {
    if (!this.native || !(await this.permission.ensure())) return () => {};
    const expo: ExpoOptions = { accuracy: ACCURACY[options.accuracy ?? 'balanced'] };
    if (options.distance !== undefined) expo.distanceInterval = options.distance;
    if (options.interval !== undefined) expo.timeInterval = options.interval;
    const subscription = await this.native.watchPositionAsync(expo, (fix) =>
      this.latest.set(positionOf(fix)),
    );
    return () => subscription.remove();
  }
}

function positionOf({ coords, timestamp }: ExpoFix): Position {
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    altitude: coords.altitude,
    accuracy: coords.accuracy,
    heading: coords.heading,
    speed: coords.speed,
    timestamp,
  };
}
