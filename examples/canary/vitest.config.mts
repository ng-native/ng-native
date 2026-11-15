import { ngNative } from '@ng-native/testing/vitest';
import { deviceTests } from '@ng-native/testing/device/vitest';
import { defineConfig } from 'vitest/config';

// Two projects. `node` compiles Angular for the tests the way Metro compiles it for the app and
// runs them in Node against a fake of the native side. `macos` runs `src/device-tests` inside the
// running app on this Mac, which it opens itself: start Metro with EXPO_PUBLIC_DEVICE_TESTS=1, then
// `npx vitest --project macos`. `npm test` runs `node` alone.
export default defineConfig({
  test: {
    projects: [
      { plugins: [ngNative()], test: { name: 'node', maxWorkers: 1, testTimeout: 30_000 } },
      {
        plugins: [deviceTests({ platform: 'macos', include: ['src/device-tests/**/*.device.ts'] })],
      },
    ],
  },
});
