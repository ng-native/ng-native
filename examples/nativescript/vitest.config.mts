import { ngNative } from '@ng-native/testing/vitest';
import { defineConfig } from 'vitest/config';

// Compiles Angular for the tests the way Metro compiles it for the app. Tests run in Node against
// a fake of the native side: no simulator, no device.
export default defineConfig({
  test: { maxWorkers: 1, testTimeout: 30_000 },
  plugins: [ngNative()],
});
