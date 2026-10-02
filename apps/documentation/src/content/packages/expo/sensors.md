---
title: Sensors
summary: Accelerometer, gyroscope, magnetometer, device motion, barometer and light, one shape.
---

# Sensors

Six motion and environment sensors, bound to `expo-sensors`: `Accelerometer`, `Gyroscope`,
`Magnetometer`, `DeviceMotion`, `Barometer` and `LightSensor`.

Every one of them is the same object underneath - `addListener`, `setUpdateInterval`,
`isAvailableAsync` - so this is one `Sensor` class parameterized by the reading, not one per
sensor. That is also why these are injection tokens rather than six `@Service()` classes: a
`@Service()` class cannot be generic in the thing it reports, so each sensor is a distinct
`InjectionToken<Sensor<T>>` that shares the one implementation.

## Install

```sh
npx expo install expo-sensors
```

```ts
import {
  Accelerometer,
  Gyroscope,
  Magnetometer,
  DeviceMotion,
  Barometer,
  LightSensor,
} from '@ng-native/expo/sensors';
```

## The smallest useful example

```ts
import { Component, DestroyRef, inject } from '@angular/core';
import { Accelerometer } from '@ng-native/expo/sensors';

@Component({
  selector: 'app-shake-detector',
  template: `<text>z: {{ motion.reading().z.toFixed(2) }}</text>`,
})
export class ShakeDetector {
  protected readonly motion = inject(Accelerometer);

  constructor() {
    inject(DestroyRef).onDestroy(this.motion.start(50));
  }
}
```

Nothing is subscribed until `start` is called, and the interval is explicit rather than defaulted
away: the sensible interval is a property of what the app is doing with the reading - a compass
wants a tenth of a second, a shake detector less - and every event is a change-detection pass, so a
sensor left at its default is a phone that never idles.

## What each one reports

- **`Accelerometer`** - `{ x, y, z }` in g. Includes gravity, so a phone lying flat reads about `1`
  on `z`.
- **`Gyroscope`** - `{ x, y, z }`, rotation in radians per second.
- **`Magnetometer`** - `{ x, y, z }`, the magnetic field in microteslas. What a compass is built on.
- **`DeviceMotion`** - everything at once: `acceleration`, `accelerationIncludingGravity`,
  `rotation`, `rotationRate`, `orientation`, `interval`.
- **`Barometer`** - `{ pressure, relativeAltitude }`, pressure in hectopascals. Present on fewer
  devices than the rest; check `available` before relying on it.
- **`LightSensor`** - `{ illuminance }` in lux. Android only.

Each is read the same way regardless of the shape:

- **`reading`** - a signal, the most recent value, or the stated zero until the sensor has said
  anything.
- **`available`** - `boolean | null`. Null until the platform has answered, which is always one
  turn away even though the underlying question is really a constant - `isAvailableAsync` is
  asynchronous regardless. A signal rather than the promise the module itself offers, because the
  question is normally asked in a template (`@if (barometer.available())`), and a promise there is
  truthy on the first frame and every frame after: exactly the failure this project keeps guarding
  against.
- **`start(intervalMs = 100)`** - starts the listener at that interval and returns the function
  that stops it. One sensor serves the whole app, so each call adds a claim of its own rather than
  restarting: the sensor reads while any claim is live, at the fastest interval among them, and the
  returned function gives back only its own claim.
- **`stop()`** - stops the sensor for everyone who started it, dropping every claim. Call the
  returned cleanup function when one caller no longer needs readings, and `stop()` only to end all
  of them.

## Without the module

On iOS and Android, a missing `expo-sensors` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when a sensor first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `available` resolves to `false`. `reading` stays at
the stated zero (all axes `0`, or the equivalent rest state for `DeviceMotion`). `start()` returns a
function that does nothing.

## Reference

<!-- api: Sensor -->
