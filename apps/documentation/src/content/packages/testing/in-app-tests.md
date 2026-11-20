---
title: Tests inside the running app
summary: Run component tests inside the running app on a Mac, a simulator or an emulator, and on CI.
---

# Tests inside the running app

A Node test renders into a fake of the native side. An in-app test renders through the running
app's own engine onto real native views, so layout, text measurement, native modules and what is
drawn are the OS's own. The files are Vitest files, run by Vitest's own runner inside the app, and
`vitest` runs them as it runs Node tests: it starts Metro, builds and installs the app, boots the
simulator or emulator, and reports to the same terminal, watch mode and CI.

## Set up

Metro wraps its config with `withDeviceTests`, and the app's entry starts the test host when Metro
is started with `EXPO_PUBLIC_DEVICE_TESTS` set:

```js
const { withDeviceTests } = require('@ng-native/testing/device/metro');

module.exports = withDeviceTests(config);
```

```ts
if (process.env.EXPO_PUBLIC_DEVICE_TESTS) {
  const { startDeviceTests } = require('@ng-native/testing/device/host');
  startDeviceTests({ mount: mountOptions() });
}
```

A project per OS goes in the Vitest config, beside the Node project. Device tests are the files
that end in `.device.ts` under `src`:

```ts
import { defineConfig } from 'vitest/config';
import { ngNative } from '@ng-native/testing/vitest';
import { deviceTests } from '@ng-native/testing/device/vitest';

export default defineConfig({
  test: {
    projects: [
      { plugins: [ngNative()], test: { name: 'node' } },
      { plugins: [deviceTests({ platform: 'ios', device: 'iPhone 17 Pro' })] },
      { plugins: [deviceTests({ platform: 'android', device: 'Pixel_7_API_36' })] },
      { plugins: [deviceTests({ platform: 'macos' })] },
    ],
  },
});
```

What each OS needs on the machine:

- iOS: Xcode with an iOS simulator, and CocoaPods.
- Android: the Android SDK (`ANDROID_HOME`, or where Android Studio puts it), an emulator made in
  Android Studio's Device Manager, and a JDK 17 in `JAVA_HOME`.
- macOS: the desktop host; see [Testing on another OS](/packages/testing/testing-other-os).

## Run

```sh
npx vitest --project ios
npx vitest run --project android
```

A run starts Metro on a free port with `EXPO_PUBLIC_DEVICE_TESTS=1`, so it never meets the dev
server you have on 8081, and stops it when Vitest exits. It boots the simulator or emulator
`device` names, unless it is running already, installs the app afresh so no data of an earlier run
is left, and launches it.

The first run builds the development build, which takes some minutes, and prints where its log is.
The build is kept in `node_modules/.cache/ng-native-device-tests`, by the project's native
fingerprint (the one EAS and `expo-updates` compute), so later runs take seconds and the app is
built again only when native code, app config or a native dependency changes. A project without
`ios` and `android` folders is prebuilt first, as `expo run` would.

Watch mode works as for Node tests: an edit under `src` runs the tests again, in the app that is
already open, in under a second.

Without `device`, a run uses a simulator or emulator that is running, or else the newest iPhone or
the first emulator. Name one to get the same screenshots on every machine.

### Running by hand

`launch: false` leaves the app, and Metro, to you, as for a phone on a cable or Expo Go (which
cannot take screenshots):

```ts
deviceTests({ platform: 'ios', launch: false });
```

```sh
EXPO_PUBLIC_DEVICE_TESTS=1 npx expo start
npx vitest --project ios
```

The run waits for the app to connect. A simulator reaches the pool at `127.0.0.1:51730` and an
emulator at `10.0.2.2:51730`; a phone on a cable needs an address it can reach, given to
`startDeviceTests({ url })`, such as `http://127.0.0.1:51730` on Android after
`adb reverse tcp:51730 tcp:51730`.

## On CI

The same command runs on CI, with no Metro to start and no app to build first. Cache the build
directory so a run that changes only JavaScript builds nothing; the run checks the fingerprint
itself, so a cache that is out of date is built again, not used. With GitHub Actions:

```yaml
jobs:
  ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - uses: actions/cache@v6
        with:
          path: node_modules/.cache/ng-native-device-tests
          key: device-tests-ios-${{ hashFiles('package-lock.json', 'app.json') }}
          restore-keys: device-tests-ios-
      - run: npx vitest run --project ios

  android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - uses: actions/setup-java@v6
        with:
          distribution: zulu
          java-version: 17
      - run: npm ci
      - uses: actions/cache@v6
        with:
          path: node_modules/.cache/ng-native-device-tests
          key: device-tests-android-${{ hashFiles('package-lock.json', 'app.json') }}
          restore-keys: device-tests-android-
      - name: Enable KVM
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' \
            | sudo tee /etc/udev/rules.d/99-kvm4all.rules
          sudo udevadm control --reload-rules
          sudo udevadm trigger --name-match=kvm
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 34
          target: google_apis
          arch: x86_64
          script: npx vitest run --project android
```

The Android job starts the emulator with `android-emulator-runner`, and the run finds it running;
an emulator the run starts itself has no window when `CI` is set. Without a `device`, a CI run uses
the simulator or emulator the runner has, so keep screenshot references to what CI runs (see
[Screenshots](#screenshots)).

## What a run does on a Mac

Each run starts the desktop host with fresh state: a new Application Support, Caches and temporary
directory, a new defaults suite, and Keychain items of its own that are removed when the run ends.
The windows are real and on screen, but the app does not take focus from what you are using; a test
that needs the key window asks for it. Calls that show system UI, such as open and save panels,
permission prompts and Touch ID, answer as if you had cancelled them, so a run never waits on you.

If the host crashes, the file that was running fails with the path of the crash report in
`~/Library/Logs/DiagnosticReports`, a new host starts on new state, and the remaining files run. On
an iOS simulator the failure names the simulator's crash report the same way, and on Android it
ends with Android's crash log.

## Writing a test

```ts
import { measure, render, screen } from '@ng-native/testing/device';
import { expect, it } from 'vitest';

it('lays the row out as native does', async () => {
  await render(Row);
  const left = measure(screen.getByTestId('left'))!;
  expect(left.width).toBeCloseTo(100, 0);
});
```

`screen` has the queries of the Node `screen`, `measure` is where native laid a node out, and
`press` sends a touch through the engine. Snapshots are kept per OS.

## Screenshots

`toMatchScreenshot` compares what the app drew with a reference image kept beside the test, on an
iOS simulator or an Android emulator:

```ts
import { render, screen } from '@ng-native/testing/device';
import { expect, it } from 'vitest';

it('draws the card', async () => {
  await render(Card);
  await expect(screen.getByTestId('card')).toMatchScreenshot('card');
});
```

What it captures:

- a node, such as `screen.getByTestId('card')`: the part of the window it covers, with whatever is
  drawn over it;
- a region of the window in points, `{ x, y, width, height }`, in the coordinates `measure` gives;
- `screen`: the whole window.

The capture is the app's window as iOS or Android drew it, text included. It is taken again until
two captures in a row agree, so an animation finishes first.

The reference for `card` in `card.device.ts` is `__screenshots__/card.device.ts/card-ios.png` (or
`card-android.png`) beside the test file. Without a name, a screenshot is named after its test and
a count. A missing reference is recorded and the test passes, except on CI, where it fails;
`vitest -u` records every reference again. Commit the references.

The match is exact by default: one pixel changed fails the test, and the failure writes the capture
(`card-ios-actual.png`) and a difference (`card-ios-diff.png`) next to the reference. They go once
the screenshot matches again. Allow a difference for every screenshot in the project, or in one
call:

```ts
deviceTests({
  platform: 'ios',
  screenshots: { comparatorOptions: { allowedMismatchedPixelRatio: 0.001 } },
});
```

```ts
await expect(chart).toMatchScreenshot('chart', {
  comparatorOptions: { threshold: 0.1, allowedMismatchedPixels: 20 },
});
```

`threshold` (0 to 1) is how far a pixel's colour may move before it counts as different,
`allowedMismatchedPixels` and `allowedMismatchedPixelRatio` how many pixels may differ, and
`includeAA: false` leaves out pixels taken for anti-aliasing. The names are those of Vitest's
browser mode.

A simulator or emulator draws text and anti-aliasing a little differently from another model or OS
version, so references belong to one: record them where the tests run on CI. When CI is the only
place that matches, let a CI run fail on a missing reference, which keeps the capture as
`card-ios-actual.png`; upload the `__screenshots__` folders as an artifact when the job fails, and
commit the captures as the references, without `-actual`.

The capture comes from a native module in `@ng-native/testing`, which the build the run makes
includes. It needs Android 8 (API 26) or later. Expo Go does not have it, and macOS does not yet.

## When a run fails to start

- **The build failed:** the error names the build log, in the cache directory. A build that needs
  something on the machine (CocoaPods, a JDK, the Android SDK) says so there.
- **No simulator or emulator of that name:** the error lists the ones there are.
- **The app did not connect:** the app crashed at launch, or its entry does not call
  `startDeviceTests()` when `EXPO_PUBLIC_DEVICE_TESTS` is set.
- **Port 51730 is in use:** another Vitest run still has it.
