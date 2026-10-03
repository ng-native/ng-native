import { ngNative } from '@ng-native/testing/vitest';
import { defineConfig } from 'vitest/config';

// Compiles Angular for the tests the way Metro compiles it for the app. Tests run in Node against
// a fake of the native side: no simulator, no device. `@analogjs/router` ships partial-compiled
// code, which has to come through the plugin to be linked.
export default defineConfig({
  plugins: [ngNative({ inline: [/\/node_modules\/@analogjs\//] })],
});
