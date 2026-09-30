---
title: Write a native module
summary: Write Swift and Kotlin for a capability no package covers, and inject it as an Angular service.
---

# Write a native module

[`@ng-native/expo`](/packages/expo) covers Expo's own modules, and any other Expo module can be
[used directly](/packages/expo/using-a-module). When no package does what the app needs, write
the native code yourself. An Angular app's native module is an ordinary Expo module: the Swift
and Kotlin are the same as for any Expo app. Only the JavaScript side is different, because the
module is reached through an injected service rather than a React hook.

This guide builds a module that reports the device's thermal state, so an app can do less work
when the phone is hot. It has one of each thing a module can expose to JavaScript:

| Native          | Name               | What it does                                         |
| --------------- | ------------------ | ---------------------------------------------------- |
| `Constant`      | `supported`        | Whether the platform reports a thermal state at all. |
| `Function`      | `getState`         | The state now, answered synchronously.               |
| `AsyncFunction` | `getHeadroomAsync` | How close the device is to throttling, as a promise. |
| `Events`        | `onChange`         | Fires when the state changes.                        |

A native module needs a development build: [Expo Go](https://expo.dev/go) contains only the
native modules it was built with, so it cannot load one you wrote. You need Xcode for iOS and
Android Studio for Android.

## Create the module

From the root of the app, generate a local module with Expo's scaffolding tool:

```sh
npx create-expo-module@latest --local thermal \
  --name Thermal \
  --package expo.modules.thermal \
  --platform apple android \
  --features Constant Function AsyncFunction Event
```

A local module lives in `modules/` inside the app, and Expo's autolinking finds it there with no
entry in `package.json`. The command creates:

```text
modules/thermal/
  expo-module.config.json      # which native classes are modules, per platform
  ios/Thermal.podspec
  ios/ThermalModule.swift
  android/build.gradle
  android/src/main/java/expo/modules/thermal/ThermalModule.kt
  src/ThermalModule.ts         # a React-style wrapper
  src/ThermalModule.web.ts
  src/Thermal.types.ts
```

Delete `modules/thermal/src`. Its wrapper imports `expo` statically and calls
`requireNativeModule`, which throws where the module is not in the build. The service below does
that job instead.

```sh
rm -rf modules/thermal/src
```

## Write the Swift

Replace `modules/thermal/ios/ThermalModule.swift`. `Name` is the name JavaScript asks for, and
each other entry in the definition is one member of the object JavaScript receives:

```swift
import ExpoModulesCore

public class ThermalModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("Thermal")

    Events("onChange")

    Constant("supported") {
      true
    }

    Function("getState") {
      Self.state()
    }

    AsyncFunction("getHeadroomAsync") { () -> Double? in
      nil // iOS has no headroom forecast
    }

    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(
        forName: ProcessInfo.thermalStateDidChangeNotification,
        object: nil,
        queue: nil
      ) { [weak self] _ in
        self?.sendEvent("onChange", ["state": Self.state()])
      }
    }

    OnStopObserving {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
      }
      self.observer = nil
    }
  }

  private static func state() -> String {
    switch ProcessInfo.processInfo.thermalState {
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    default: return "nominal"
    }
  }
}
```

`OnStartObserving` runs when JavaScript adds the first `onChange` listener and `OnStopObserving`
when it removes the last, so the module observes the system only while something is listening.
Returning `nil` from an `AsyncFunction` resolves the promise with `null`.

## Write the Kotlin

Replace `modules/thermal/android/src/main/java/expo/modules/thermal/ThermalModule.kt`. The
definition has the same names, so JavaScript sees the same object on both platforms:

```kotlin
package expo.modules.thermal

import android.content.Context
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ThermalModule : Module() {
  private val powerManager
    get() = appContext.reactContext!!.getSystemService(Context.POWER_SERVICE) as PowerManager

  private val listener = PowerManager.OnThermalStatusChangedListener { status ->
    sendEvent("onChange", mapOf("state" to name(status)))
  }

  override fun definition() = ModuleDefinition {
    Name("Thermal")

    Events("onChange")

    // Thermal status arrived in Android 10 (API 29).
    Constant("supported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
    }

    Function("getState") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) name(powerManager.currentThermalStatus) else "nominal"
    }

    AsyncFunction("getHeadroomAsync") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@AsyncFunction null
      val headroom = powerManager.getThermalHeadroom(10)
      if (headroom.isNaN()) null else headroom.toDouble()
    }

    OnStartObserving {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        powerManager.addThermalStatusListener(listener)
      }
    }

    OnStopObserving {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        powerManager.removeThermalStatusListener(listener)
      }
    }
  }

  private fun name(status: Int) = when (status) {
    PowerManager.THERMAL_STATUS_NONE -> "nominal"
    PowerManager.THERMAL_STATUS_LIGHT, PowerManager.THERMAL_STATUS_MODERATE -> "fair"
    PowerManager.THERMAL_STATUS_SEVERE -> "serious"
    else -> "critical"
  }
}
```

Android reports seven levels and iOS four. The module maps Android's onto iOS's names, so the
service has one set of states to handle.

## Wrap it as a service

The service is the only file that knows the native module exists. Everything else injects
`Thermal` and reads signals. Create `src/thermal/thermal.ts`:

```ts
import { DestroyRef, InjectionToken, Service, inject, signal } from '@angular/core';

export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical';

/** What modules/thermal declares natively, written out for TypeScript. */
export interface NativeThermal {
  readonly supported: boolean;
  getState(): ThermalState;
  getHeadroomAsync(): Promise<number | null>;
  addListener(
    event: 'onChange',
    listener: (event: { state: ThermalState }) => void,
  ): { remove(): void };
}

@Service()
export class Thermal {
  /** The native module, or null where it is not in the build. Overridden in tests. */
  static readonly NATIVE = new InjectionToken<NativeThermal | null>('Thermal.native', {
    // Required lazily: a static import of 'expo' cannot load in Node, where tests run.
    factory: () =>
      typeof require === 'function'
        ? (require('expo') as typeof import('expo')).requireOptionalNativeModule<NativeThermal>(
            'Thermal',
          )
        : null,
  });

  private readonly native = inject(Thermal.NATIVE);
  private readonly current = signal<ThermalState>(this.native?.getState() ?? 'nominal');

  readonly state = this.current.asReadonly();
  readonly supported = this.native?.supported ?? false;

  constructor() {
    const subscription = this.native?.addListener('onChange', ({ state }) =>
      this.current.set(state),
    );
    inject(DestroyRef).onDestroy(() => subscription?.remove());
  }

  /** How close the device is to throttling, 0 to 1. Null on iOS and before Android 11. */
  headroom(): Promise<number | null> {
    return this.native?.getHeadroomAsync() ?? Promise.resolve(null);
  }
}
```

Each part has a reason:

- **`NativeThermal`** is the native definition written out in TypeScript. Nothing checks it
  against the Swift and Kotlin, so a name spelled differently on one side is `undefined` at run
  time. Keep the two in step by hand.
- **`requireOptionalNativeModule`** answers `null` rather than throwing where the module is not
  in the build: Expo Go, or a development build made before the module existed. The service then
  reports `nominal` and `supported: false` instead of crashing the screen that injected it.
- **`require` inside the factory**, rather than `import { requireOptionalNativeModule } from
'expo'` at the top of the file. `expo` pulls in `react-native`, which Node cannot load, so a
  static import fails every test that reaches this file, even one that never uses the module.
  Metro bundles the `require` exactly as it would an import. In a test,
  [the Vitest plugin](/packages/testing/setup) hides `require`, so the factory answers `null`.
- **The `NATIVE` token** is the seam for tests. It carries its own factory, so the app provides
  nothing, and a test provides a fake in its place.
- **Signals for state, a promise for a one-off question.** The event keeps `state` current, and
  the listener is removed when the service is destroyed.

## Use it in a component

Inject the service and read it like any other signal. This is the template's `App` with three
lines of thermal state added:

```ts
import { Component, inject, resource, signal } from '@angular/core';
import { Pressable, SafeAreaProvider, SafeAreaView, Text, View } from '@ng-native/components';
import { Thermal } from '../thermal/thermal.ts';

@Component({
  imports: [Pressable, SafeAreaProvider, SafeAreaView, Text, View],
  selector: 'app-root',
  template: `
    <safe-area-provider>
      <safe-area-view class="screen">
        <view class="body">
          <text class="title">Angular, natively</text>
          <text class="hint">Real native views. React is never in the render path.</text>

          <pressable accessibilityRole="button" class="button" (press)="count.set(count() + 1)">
            <text class="label">Tapped {{ count() }} times</text>
          </pressable>

          <text class="hint">Thermal state: {{ thermal.state() }}</text>
          <text class="hint">Supported: {{ thermal.supported }}</text>
          <text class="hint">Headroom: {{ headroom.value() ?? 'unknown' }}</text>
        </view>
      </safe-area-view>
    </safe-area-provider>
  `,
  styles: `
    /* unchanged from the template */
  `,
})
export class App {
  protected readonly count = signal(0);
  protected readonly thermal = inject(Thermal);
  protected readonly headroom = resource({ loader: () => this.thermal.headroom() });
}
```

## Test it

Tests run in Node, where there is no native module. Provide a fake for `Thermal.NATIVE` and the
service runs against it unchanged. Create `src/thermal/thermal.test.ts`:

```ts
import { render, screen } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from '../app/app.ts';
import { Thermal, type NativeThermal, type ThermalState } from './thermal.ts';

test('shows the thermal state and follows its changes', async () => {
  let emit: (event: { state: ThermalState }) => void = () => {};
  const fake: NativeThermal = {
    supported: true,
    getState: () => 'fair',
    getHeadroomAsync: async () => 0.4,
    addListener: (_event, listener) => {
      emit = listener;
      return { remove: () => {} };
    },
  };

  await render(App, { providers: [{ provide: Thermal.NATIVE, useValue: fake }] });

  expect(screen.getByText('Thermal state: fair')).toBeTruthy();
  expect(await screen.findByText('Headroom: 0.4')).toBeTruthy();

  emit({ state: 'serious' });
  expect(await screen.findByText('Thermal state: serious')).toBeTruthy();
});

test('stays quiet where the module is not in the build', async () => {
  await render(App, { providers: [{ provide: Thermal.NATIVE, useValue: null }] });

  expect(screen.getByText('Thermal state: nominal')).toBeTruthy();
  expect(screen.getByText('Supported: false')).toBeTruthy();
});
```

```sh
npm test
```

A test that provides nothing, such as the template's own `app.test.ts`, also passes: the factory
answers `null` in Node, so the service is inert rather than broken.

## Build and run

```sh
npx expo run:ios
npx expo run:android
```

The first run generates the `ios` and `android` projects, links the module through autolinking,
and switches the `ios` and `android` scripts in `package.json` to `expo run:*`. After that:

- **A change to TypeScript** reloads through Metro, as usual.
- **A change to Swift, Kotlin or `expo-module.config.json`** needs `npx expo run:ios` or
  `npx expo run:android` again. Fast Refresh does not reload native code.

On the iOS simulator the screen shows `Thermal state: nominal`, `Supported: true` and
`Headroom: unknown`. `Supported: true` comes from the native constant: without the module it
would read `false`.

The Android emulator can fake a thermal event, which exercises the whole path from Kotlin to the
signal:

```sh
adb shell cmd thermalservice override-status 3   # 3 is SEVERE: the screen shows "serious"
adb shell cmd thermalservice reset
```

## Going further

- **Views.** A module can also render a native view. Add `View` to `--features`, then register
  the view as an element with `registerExpoView`; see [Native views](/packages/expo/native-views).
- **More native API.** The module definition supports more than this page uses: shared objects,
  typed records for arguments, and `OnCreate`/`OnDestroy` lifecycle hooks. Expo's
  [Modules API reference](https://docs.expo.dev/modules/module-api/) lists them. Each is exposed to
  JavaScript the same way, so the service pattern above does not change.
- **Sharing it.** To use the module in more than one app, generate it without `--local` to get a
  standalone package, publish it, and install it like any other Expo module.
