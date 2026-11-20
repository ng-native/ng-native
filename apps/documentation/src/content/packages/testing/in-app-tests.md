---
title: Tests inside the running app
summary: Run component tests inside the running app on a Mac, a simulator or an emulator.
---

# Tests inside the running app

A Node test renders into a fake of the native side. An in-app test renders through the running
app's own engine onto real native views, so layout, text measurement and native modules are the
platform's. The files are Vitest files, run by Vitest's own runner inside the app.

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

A project per platform goes in the Vitest config. `platform: 'macos'` opens the desktop host for
you; on iOS and Android you open the app on the simulator or emulator.

```ts
import { defineConfig } from 'vitest/config';
import { ngNative } from '@ng-native/testing/vitest';
import { deviceTests } from '@ng-native/testing/device/vitest';

export default defineConfig({
  test: {
    projects: [
      { plugins: [ngNative()], test: { name: 'node' } },
      { plugins: [deviceTests({ platform: 'macos' })] },
      { plugins: [deviceTests({ platform: 'ios' })] },
    ],
  },
});
```

```sh
EXPO_PUBLIC_DEVICE_TESTS=1 npx expo start
npx vitest --project macos
```

## What a run does on a Mac

Each run starts the desktop host with fresh state: a new Application Support, Caches and temporary
directory, a new defaults suite, and Keychain items of its own that are removed when the run ends.
The windows are real and on screen, but the app does not take focus from what you are using; a test
that needs the key window asks for it. Calls that show system UI, such as open and save panels,
permission prompts and Touch ID, answer as if you had cancelled them, so a run never waits on you.

If the host crashes, the file that was running fails with the path of the crash report in
`~/Library/Logs/DiagnosticReports`, a new host starts on new state, and the remaining files run.

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
`press` sends a touch through the engine. Snapshots are kept per platform.

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

The capture is the app's window as iOS or Android drew it, text included. It is taken
again until two captures in a row agree, so an animation finishes first.

The reference for `card` in `card.device.ts` is
`__screenshots__/card.device.ts/card-ios.png` (or `card-android.png`) beside the test file. Without
a name, a screenshot is named after its test and a count. A missing reference is recorded and the
test passes, except on CI, where it fails; `vitest -u` records every reference again. Commit the
references.

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

A device draws text and anti-aliasing a little differently from another model or OS version, so
keep each OS's references to one simulator or emulator model and version, as CI runs them.

The capture comes from a native module in `@ng-native/testing`, so rebuild the development build
after installing or upgrading the package. It needs Android 8 (API 26) or later; Expo Go does not
have it, and macOS does not yet.
