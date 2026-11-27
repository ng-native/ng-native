import { ngNative } from '@ng-native/testing/vitest';
import { deviceTests } from '@ng-native/testing/device/vitest';
import { defineConfig } from 'vitest/config';

// Three projects. `node` compiles Angular for the tests the way Metro compiles it for the app and
// runs them in Node against a fake of the native side: no simulator, no device. `ios` and
// `android` run the `*.device.ts` files inside the running app on a simulator or emulator,
// starting Metro, the build and the app themselves. `npm test` runs `node` alone.
export default defineConfig({
  test: {
    projects: [
      { plugins: [ngNative()], test: { name: 'node' } },
      { plugins: [deviceTests({ platform: 'ios' })] },
      { plugins: [deviceTests({ platform: 'android' })] },
    ],
  },
});
