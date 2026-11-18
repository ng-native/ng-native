import { ngNative } from '@ng-native/testing/vitest';
import { deviceTests } from '@ng-native/testing/device/vitest';
import { defineConfig } from 'vitest/config';

// Three projects. `node-macos` and `node-linux` compile Angular for the tests the way Metro
// compiles it for the app and run them in Node against a fake of the native side: no app window.
// `macos` runs the `*.device.ts` files inside the running app on this Mac, which it opens itself;
// start Metro with EXPO_PUBLIC_DEVICE_TESTS=1 first. `npm test` runs the two Node projects alone.
export default defineConfig({
  test: {
    projects: [
      { plugins: [ngNative({ os: 'macos' })], test: { name: 'node-macos' } },
      { plugins: [ngNative({ os: 'linux' })], test: { name: 'node-linux' } },
      { plugins: [deviceTests({ platform: 'macos' })] },
    ],
  },
});
