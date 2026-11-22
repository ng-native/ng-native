import { ngNative } from '@ng-native/testing/vitest';
import { deviceTests } from '@ng-native/testing/device/vitest';
import { defineConfig } from 'vitest/config';

// `node` compiles Angular for the tests the way Metro compiles it for the app and runs them in Node
// against a fake of the native side; `npm test` runs it alone. The others run tests inside the app:
// `npx vitest --project macos` on this Mac, `--project ios` on a simulator and `--project android`
// on an emulator. Each starts Metro and the app itself, building the app the first time.
const phone = ['src/device-tests/phone/**/*.device.ts'];

export default defineConfig({
  test: {
    projects: [
      { plugins: [ngNative()], test: { name: 'node', maxWorkers: 1, testTimeout: 30_000 } },
      { plugins: [deviceTests({ platform: 'macos', include: ['src/device-tests/*.device.ts'] })] },
      { plugins: [deviceTests({ platform: 'ios', include: phone })] },
      { plugins: [deviceTests({ platform: 'android', include: phone })] },
    ],
  },
});
