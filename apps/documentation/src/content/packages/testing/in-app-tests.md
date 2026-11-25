---
title: Tests inside the running app
summary: Run component tests inside the running app on a Mac, Linux, a simulator, an emulator or CI.
---

# Tests inside the running app

A Node test renders into a fake of the native side. An in-app test renders through the running
app's own engine onto real native views, so layout, text measurement, native modules and what is
drawn are the OS's own. The files are Vitest files, run by Vitest's own runner inside the app, and
`vitest` runs them as it runs Node tests: it starts Metro, builds and installs the app, boots the
simulator or emulator, and reports to the same terminal, watch mode and CI.

## Setup

An app made from the template, or by `@ng-native/nx` or `@ng-native/schematics`, at this release or
later has all of this already, with `ios` and `android` projects (`macos` for a desktop-only app)
and an example, `src/app/app.device.ts`. A desktop-only app that later adds iOS and Android keeps
only its macOS projects, and adds the `ios` and `android` ones below. An app made before, or any
other app, adds three things.

Metro wraps its config with `withDeviceTests`, and the app's entry starts the test host when Metro
is started with `EXPO_PUBLIC_DEVICE_TESTS` set. The host mounts with the app's own options, so an
entry that passes `mount` its options inline moves them into a function, `mountOptions` here, that
both `mount(..., mountOptions())` and the host use. The host is given the function itself and calls
it each time it mounts, so the conditions it reads are the device's at that mount:

```js
const { withDeviceTests } = require('@ng-native/testing/device/metro');

module.exports = withDeviceTests(config);
```

```ts
import { watchConditions } from '@ng-native/device';

if (process.env.EXPO_PUBLIC_DEVICE_TESTS) {
  // Typed as the module, so the callbacks below are typed too.
  const { startDeviceTests } =
    require('@ng-native/testing/device/host') as typeof import('@ng-native/testing/device/host');
  startDeviceTests({
    mount: mountOptions,
    // What the app's runnable does after mount, for the host too, with the same options (such as
    // { darkClass: false }), or no onMount if the app does nothing: here, following rotation, the
    // theme and reduced motion.
    onMount: (app) => {
      const stopWatching = watchConditions(app.engine);
      app.applicationRef.onDestroy(stopWatching);
    },
  });
} else {
  // The app's own runnable, moved here whole, with all it does after mount (such as
  // watchConditions), and only outside the tests: a second registration of 'main' would replace
  // the test host.
  AppRegistry.registerRunnable('main', ({ rootTag }) => {
    const app = mount(Number(rootTag), App, getFabricUIManager(), mountOptions());
    // ...the rest of the app's runnable, as it was.
  });
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
      { plugins: [deviceTests({ platform: 'linux' })] },
    ],
  },
});
```

Device tests need Vitest 5. What each OS needs on the machine:

- iOS: Xcode with an iOS simulator, and CocoaPods.
- Android: the Android SDK (`ANDROID_HOME`, or where Android Studio puts it), an emulator made in
  Android Studio's Device Manager, and a JDK 17 in `JAVA_HOME`.
- macOS: the desktop host; see [Testing on another OS](/packages/testing/testing-other-os).
- Linux: the GTK host; see [What a run does on Linux](#what-a-run-does-on-linux). On a Mac it runs
  in the `ngn-el9` image.

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
`ios` and `android` folders is prebuilt first, as `expo run` would, and its `app.json`,
`app.config.*` and `package.json` are left as they were.

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

With a Metro of your own for a launched app (`metroPort`) and a pool `port` other than 51730, start
that Metro with `NG_NATIVE_DEVICE_TESTS_POOL_PORT` set to the port, which the app asks it for.

The run waits for the app to connect. A simulator reaches the pool at `127.0.0.1:51730` and an
emulator at `10.0.2.2:51730`; a phone on a cable needs an address it can reach, given to
`startDeviceTests({ url })`, such as `http://127.0.0.1:51730` on Android after
`adb reverse tcp:51730 tcp:51730`.

## On CI

The same command runs on CI, with no Metro to start and no app to build first. Cache the build
directory so a run that changes only JavaScript builds nothing; the run checks the fingerprint
itself, so a cache that is out of date is built again, not used. Save the cache whether the tests
pass or not (`actions/cache` on its own saves only when they do), or a failing test means a cold
build on the next run, and under a key of the run's own: a cache key cannot be written twice, so
one saved after a failed build would otherwise stay. With GitHub Actions:

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
      - uses: actions/cache/restore@v6
        with:
          path: node_modules/.cache/ng-native-device-tests
          key: device-tests-ios-${{ hashFiles('package-lock.json', 'app.json') }}
          restore-keys: device-tests-ios-
      - run: npx vitest run --project ios
      - if: always()
        uses: actions/cache/save@v6
        with:
          path: node_modules/.cache/ng-native-device-tests
          key: device-tests-ios-${{ hashFiles('package-lock.json', 'app.json') }}-${{ github.run_id }}

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
      - uses: actions/cache/restore@v6
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
      - if: always()
        uses: actions/cache/save@v6
        with:
          path: node_modules/.cache/ng-native-device-tests
          key: device-tests-android-${{ hashFiles('package-lock.json', 'app.json') }}-${{ github.run_id }}
```

A build from nothing takes most of a job: about 30 minutes for iOS on GitHub's macOS runners and
10 for Android. It is needed only when the native half changes; ccache (with `USE_CCACHE=1` and
`CCACHE_BINARY` set) and `gradle/actions/setup-gradle` make one that is needed shorter.

The Android job starts the emulator with `android-emulator-runner`, and the run finds it running;
an emulator the run starts itself has no window when `CI` is set. Without a `device`, a CI run uses
the simulator or emulator the runner has, so keep screenshot references to what CI runs (see
[Screenshots](#screenshots)).

## What a run does on a Mac

Each run starts the desktop host with fresh state, Keychain items included. The windows are on
screen but do not take focus from what you are using. Open and save panels, permission prompts and
Touch ID answer as if cancelled, so a run never waits on you. If the host crashes, the file that
was running fails with the path of the crash report, and the remaining files run on a new host. On
an iOS simulator the failure names the simulator's crash report the same way, and on Android it
ends with Android's crash log.

## What a run does on Linux

`platform: 'linux'` starts the GTK host on the Linux bundle of the Metro the run starts. By default
it runs the debug host `npm run linux` uses. To run another, give the host binary, the
`gtk/ngn-linux` in its build folder, as `NGN_DESKTOP_HOST` or through `linuxLauncher({ host })`:

```ts
import { deviceTests, linuxLauncher } from '@ng-native/testing/device/vitest';

deviceTests({ platform: 'linux', launch: linuxLauncher({ host: 'build/gtk/ngn-linux' }) });
```

Each run gets fresh state and an application id of its own. File choosers, links and
notifications go to a stand-in for the desktop's portals, which cancels a file chooser and shows
nothing, so a run waits for no one. It needs `dbus-daemon` and `python3` with PyGObject where the
host runs, and a user with a passwd entry in a container you start with `--user`.
`fakeSystemUi: false` runs the host against the session's own portals instead.

The windows go to the display you are using when `DISPLAY` or `WAYLAND_DISPLAY` is set. Without
one, each launch starts a headless Weston of its own. `display: 'xvfb'` starts an X server instead.

On a Mac, the host runs in a Linux container under Docker or Colima, so the host binary must be in
a folder the container can see, such as one under your home folder. Start Metro as usual.
`container: false` runs the host directly, and `NGN_LINUX_IMAGE=ngn-fedora` runs it in a Fedora
image, with a newer GTK and libadwaita.

If the host crashes, the failure quotes the crash report the host writes, naming the signal and
the native stack, then the end of the host's output.

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

## Checking styles, sizes and colours

A screenshot compares everything at once; these check one thing, and read the same on every
simulator and emulator:

```ts
import { Component, signal } from '@angular/core';
import { View } from '@ng-native/components';
import { render, screen } from '@ng-native/testing/device';
import { expect, it } from 'vitest';

@Component({
  selector: 'app-swatch',
  imports: [View],
  template: `
    <view testID="frame" style="padding: 10px">
      <view
        testID="swatch"
        style="width: 300px; height: 100px; border-radius: 12px"
        [style.backgroundColor]="warm() ? '#cc6633' : '#3366cc'"
      ></view>
    </view>
  `,
})
class Swatch {
  readonly warm = signal(false);
}

it('draws the swatch', async () => {
  await render(Swatch);
  const swatch = screen.getByTestId('swatch');
  expect(swatch).toHaveStyle({ backgroundColor: '#3366cc', borderRadius: 12 });
  expect(swatch).toHaveSize({ width: 300, height: 100 });
  expect(swatch).toBeWithin(screen.getByTestId('frame'));
  await expect(swatch).toHaveColorAt({ x: 150, y: 50 }, '#3366cc');
});
```

- `toHaveStyle` reads the props the engine committed to the node, by React Native's names. A
  colour matches as hex, `rgb()` or `rgba()` with numbers, `hsl()`, `hwb()` or a name, or as the
  integer native is given, and a value that is not one (`null`, a platform colour) matches the
  same value; a length is in points (`16`
  or `'16px'`). A shorthand the engine commits as its parts (`borderRadius`, `borderWidth`,
  `borderColor`, `padding`, `margin`) matches when every part does.
- `toHaveSize` and `toBeWithin` read where native laid the node out, as `measure` does, within
  half a point by default (`{ tolerance }`).
- `toHaveColorAt` reads the colour native drew at a point of the node (or of a region, or
  `screen`), in points from its top-left, within one step of 255 on each channel by default
  (`{ tolerance }`). Await it: it captures the window, as a screenshot does, so it needs iOS,
  Android 8 (API 26) or later, or macOS, and does not work on Linux yet. A point of a node partly
  outside the window is read where that point is drawn, and one outside the window fails.
  `colorsAt(target, points)` gives the colours themselves.

## Turning animations off

Animations play in a device test as they do in the app. `setAnimations(false)` turns off the
ones listed below from the next change on (Android's animators only where Android accepts the
call, which it reports), so what a test reads or captures is where each of those changes ends:

```ts
import { Component, signal } from '@angular/core';
import { View } from '@ng-native/components';
import { render, screen, setAnimations } from '@ng-native/testing/device';
import { expect, it } from 'vitest';

@Component({
  selector: 'app-swatch',
  imports: [View],
  template: `
    <view testID="frame" style="padding: 10px">
      <view
        testID="swatch"
        style="width: 300px; height: 100px; border-radius: 12px"
        [style.backgroundColor]="warm() ? '#cc6633' : '#3366cc'"
      ></view>
    </view>
  `,
})
class Swatch {
  readonly warm = signal(false);
}

it('lands on the warm colour', async () => {
  await setAnimations(false);
  const { instance, settle } = await render(Swatch);
  instance.warm.set(true);
  await settle();
  expect(screen.getByTestId('swatch')).toHaveStyle({ backgroundColor: '#cc6633' });
});
```

What it turns off:

- the engine's CSS transitions and `@keyframes` animations: a transition lands on its new value,
  a finite animation ends within two frames (on its last frame where its fill mode keeps it),
  and one that repeats forever is not played. One already running when animations go off is
  ended the next time its node is restyled;
- UIKit's view animations on iOS;
- every Android `Animator`, through the app's own animator duration scale. Android can refuse
  that call, and `setAnimations` then resolves `false`: the engine's animations are still off.

Animations driven from JavaScript by other means, such as Reanimated, run as before. Each test
starts with animations on, or off for every test with `deviceTests({ animations: false })`.

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

The capture is the app's window as iOS, Android or the macOS host drew it, text included. The macOS
host draws its window in process, so it asks for no screen recording permission. It is taken again
until two captures in a row agree, so what is moving between captures has stopped; one that does not
stop within `timeout` (5 seconds) fails the test. An animation that is paused, or waiting on its
delay, looks still: wait for one to end before the screenshot when it matters.

The reference for `card` in `card.device.ts` is `__screenshots__/card.device.ts/card-ios.png` (or
`card-android.png`) beside the test file. Without a name, a screenshot is named after its test and
a count. A missing reference is recorded and the test passes, except on CI, where it fails;
`vitest -u` records every reference again. Commit the references.

The match is all but exact by default: a pixel whose colour moves by more than one step of 255 in
any channel fails the test. An iOS simulator draws the odd edge pixel a step apart from one run to
the next, which this allows; `channelTolerance: 0` asks for an exact match. A failure writes the
capture (`card-ios-actual.png`) next to the reference, and a difference (`card-ios-diff.png`) when
the two are the same size; a capture of another size fails on its size alone, with no difference
image. They go once the screenshot matches again. Allow more for every screenshot in the project,
or in one call:

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

`channelTolerance` (0 to 255, default 1) is how far each channel may move before a pixel is
compared at all, `threshold` (0 to 1) how far its colour may then move before it counts as
different, `allowedMismatchedPixels` and `allowedMismatchedPixelRatio` how many pixels may differ,
and `includeAA: false` leaves out pixels taken for anti-aliasing. The names other than
`channelTolerance` are those of Vitest's browser mode.

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
