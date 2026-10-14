/**
 * The motion sensors, bound to `expo-sensors`.
 *
 * ```ts
 * private readonly motion = inject(Accelerometer);
 *
 * constructor() {
 *   inject(DestroyRef).onDestroy(this.motion.start(50));
 * }
 * ```
 *
 * Every one of them is the same object - `addListener`, `setUpdateInterval`, `isAvailableAsync` -
 * so this is one class parameterised by the reading, not one per sensor. Six services sharing one
 * class is why these are tokens rather than six decorated classes: a `@Service` class cannot be
 * generic in the thing it reports.
 *
 * Nothing is subscribed until `start`, and the interval is explicit: the sensible one is a
 * property of what the app is doing - a compass wants a tenth of a second, a shake detector less -
 * and every event is a change-detection pass, so a sensor left at its default is a phone that
 * never idles.
 */
import { InjectionToken, signal, type Signal } from '@angular/core';
import { expoModule, present as moduleThere } from './native.ts';

/** What a three-axis sensor reports. Barometer and light report their own shapes. */
export interface Vector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface NativeSensor<T> {
  addListener(listener: (reading: T) => void): { remove(): void };
  setUpdateInterval(intervalMs: number): void;
  isAvailableAsync(): Promise<boolean>;
}

export class Sensor<T> {
  private readonly native: NativeSensor<T> | null;
  private readonly current: ReturnType<typeof signal<T>>;
  private readonly present = signal<boolean | null>(null);
  private subscription: { remove(): void } | null = null;

  /** The most recent reading, or the stated zero until the sensor has said anything. */
  readonly reading: Signal<T>;

  /**
   * Whether the device has this sensor. Null until the platform has answered, which is one turn
   * away: `isAvailableAsync` is asynchronous even where the answer is a constant.
   *
   * A signal rather than the promise the module offers, because the question is asked in a
   * template - `@if (barometer.available())` - and a promise there is truthy on the first frame
   * and every frame after, which is the failure this project keeps guarding against.
   */
  readonly available: Signal<boolean | null> = this.present.asReadonly();

  constructor(native: NativeSensor<T> | null, zero: T) {
    this.native = native;
    this.current = signal(zero);
    this.reading = this.current.asReadonly();
    // Not there at all is not available; a missing module says so when it is started.
    void (moduleThere(native)?.isAvailableAsync() ?? Promise.resolve(false)).then(
      (yes) => this.present.set(yes),
      () => this.present.set(false),
    );
  }

  /**
   * Start reading, at `intervalMs` between readings. Returns the function that stops.
   *
   * Explicit rather than automatic, because the sensible interval is a property of what the app is
   * doing with it - a compass needs a tenth of a second and a shake detector needs less - and
   * because a sensor nobody stops is a battery nobody gets back.
   */
  start(intervalMs = 100): () => void {
    // One sensor serves the whole app, so each start is a claim of its own, and its stop gives
    // back that claim alone: the sensor reads while anyone still wants it, as often as the most
    // demanding of them asks.
    const claim = { intervalMs };
    this.claims.add(claim);
    this.native?.setUpdateInterval(this.fastest());
    this.subscription ??= this.native?.addListener((reading) => this.current.set(reading)) ?? null;
    return () => {
      if (!this.claims.delete(claim)) return;
      if (this.claims.size === 0) this.stop();
      else this.native?.setUpdateInterval(this.fastest());
    };
  }

  /** Every `start` not yet stopped. */
  private readonly claims = new Set<{ readonly intervalMs: number }>();

  private fastest(): number {
    return Math.min(...[...this.claims].map((claim) => claim.intervalMs));
  }

  /** Stop reading for everyone who started it. */
  stop(): void {
    this.claims.clear();
    this.subscription?.remove();
    this.subscription = null;
  }
}

export const ORIGIN: Vector = { x: 0, y: 0, z: 0 };

/** Every reading carries the time it was taken, so the zero has to as well. */
const STILL = { x: 0, y: 0, z: 0, timestamp: 0 };

type Sensors = typeof import('expo-sensors');

/** One token per sensor, each reading the module only if it is installed. */
function sensorToken<T>(pick: (expo: Sensors) => unknown, zero: T, name: string) {
  return new InjectionToken<Sensor<T>>(`angular-native.${name}`, {
    factory: () => {
      const expo = expoModule('expo-sensors', () => require('expo-sensors') as Sensors);
      // Missing from the build, the stand-in is the sensor, to say so when it is used.
      const sensor = expo && (moduleThere(expo) ? pick(expo) : expo);
      return new Sensor<T>(sensor ? (sensor as NativeSensor<T>) : null, zero);
    },
  });
}

/** In g. Includes gravity, so a phone lying flat reads about 1 on z. */
export const Accelerometer = sensorToken<import('expo-sensors').AccelerometerMeasurement>(
  (expo) => expo.Accelerometer,
  STILL,
  'accelerometer',
);
export type Accelerometer = Sensor<import('expo-sensors').AccelerometerMeasurement>;

/** Rotation, in radians per second. */
export const Gyroscope = sensorToken<import('expo-sensors').GyroscopeMeasurement>(
  (expo) => expo.Gyroscope,
  STILL,
  'gyroscope',
);
export type Gyroscope = Sensor<import('expo-sensors').GyroscopeMeasurement>;

/** The magnetic field, in microteslas. What a compass is built on. */
export const Magnetometer = sensorToken<import('expo-sensors').MagnetometerMeasurement>(
  (expo) => expo.Magnetometer,
  STILL,
  'magnetometer',
);
export type Magnetometer = Sensor<import('expo-sensors').MagnetometerMeasurement>;

/** Everything at once, plus the orientation and rotation rate derived from it. */
export const DeviceMotion = sensorToken<import('expo-sensors').DeviceMotionMeasurement>(
  (expo) => expo.DeviceMotion,
  {
    acceleration: null,
    accelerationIncludingGravity: STILL,
    rotation: { alpha: 0, beta: 0, gamma: 0 },
    rotationRate: null,
    orientation: 0,
    interval: 0,
  } as import('expo-sensors').DeviceMotionMeasurement,
  'deviceMotion',
);
export type DeviceMotion = Sensor<import('expo-sensors').DeviceMotionMeasurement>;

/** Air pressure, in hectopascals. Present on fewer devices than the rest; check `available`. */
export const Barometer = sensorToken<import('expo-sensors').BarometerMeasurement>(
  (expo) => expo.Barometer,
  { pressure: 0, relativeAltitude: 0 } as import('expo-sensors').BarometerMeasurement,
  'barometer',
);
export type Barometer = Sensor<import('expo-sensors').BarometerMeasurement>;

/** Ambient light in lux. Android only. */
export const LightSensor = sensorToken<import('expo-sensors').LightSensorMeasurement>(
  (expo) => expo.LightSensor,
  { illuminance: 0 } as import('expo-sensors').LightSensorMeasurement,
  'lightSensor',
);
export type LightSensor = Sensor<import('expo-sensors').LightSensorMeasurement>;
