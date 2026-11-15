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
