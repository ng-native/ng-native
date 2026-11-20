import { ngNative } from '@ng-native/testing/vitest';
import { deviceTests } from '@ng-native/testing/device/vitest';
import { defineConfig } from 'vitest/config';

// Four projects. `node-macos` and `node-linux` compile Angular for the tests the way Metro
// compiles it for the app and run them in Node against a fake of the native side: no app window.
// `macos` and `linux` run the `*.device.ts` files inside the running app, which they open
// themselves: `macos` on this Mac, `linux` in GTK, on Linux or in the ngn-el9 container on a Mac.
// Start Metro with EXPO_PUBLIC_DEVICE_TESTS=1 first. `npm test` runs the two Node projects alone.
export default defineConfig({
  test: {
    projects: [
      { plugins: [ngNative({ os: 'macos' })], test: { name: 'node-macos' } },
      { plugins: [ngNative({ os: 'linux' })], test: { name: 'node-linux' } },
      { plugins: [deviceTests({ platform: 'macos' })] },
      { plugins: [deviceTests({ platform: 'linux' })] },
    ],
  },
});
