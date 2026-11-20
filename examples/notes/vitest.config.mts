import { ngNative } from '@ng-native/testing/vitest';
import { deviceTests } from '@ng-native/testing/device/vitest';
import { defineConfig } from 'vitest/config';

// Three projects. `node` compiles Angular for the tests the way Metro compiles it for the app and
// runs them in Node against a fake of the native side: no simulator, no device. `macos` and `linux`
// run `src/device-tests` inside the running app on the desktop host, which the pool opens itself:
// start Metro with EXPO_PUBLIC_DEVICE_TESTS=1, then `npx vitest --project linux` with
// NGN_DESKTOP_HOST naming the GTK host. `npm test` runs `node` alone.
export default defineConfig({
  test: {
    projects: [
      { plugins: [ngNative()], test: { name: 'node', maxWorkers: 1, testTimeout: 30_000 } },
      {
        plugins: [deviceTests({ platform: 'macos', include: ['src/device-tests/**/*.device.ts'] })],
      },
      {
        plugins: [deviceTests({ platform: 'linux', include: ['src/device-tests/**/*.device.ts'] })],
      },
    ],
  },
});
