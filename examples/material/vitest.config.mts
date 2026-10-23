import { ngNative } from '@ng-native/testing/vitest';
import { webCompat } from '@ng-native/web-compat/vitest';
import { defineConfig } from 'vitest/config';

// Compiles Angular for the tests the way Metro compiles it for the app, with Material's sheets
// read as a browser reads them. Tests run in Node against a fake of the native side.
export default defineConfig({
  test: { maxWorkers: 1, testTimeout: 30_000 },
  plugins: [
    webCompat({ libraries: ['@angular/cdk', '@angular/material'] }),
    ngNative({ inline: [/@angular\/cdk/, /@angular\/material/] }),
  ],
});
