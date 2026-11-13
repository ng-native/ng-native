import { ngNative } from '@ng-native/testing/vitest';
import { webCompat } from '@ng-native/web-compat/vitest';
import { defineConfig } from 'vitest/config';

// Compiles Angular for the tests the way Metro compiles it for the app, with Taiga's sheets read
// as a browser reads them. Taiga, and the `@ng-web-apis` and Maskito packages it reaches for, ship
// partially compiled, so they are linked too. Tests run in Node against a fake of the native side.
export default defineConfig({
  test: { maxWorkers: 1, testTimeout: 30_000 },
  plugins: [
    webCompat({ libraries: ['@angular/cdk', '@taiga-ui/cdk', '@taiga-ui/core', '@taiga-ui/kit'] }),
    ngNative({ inline: [/@angular\/cdk/, /@taiga-ui\//, /@ng-web-apis\//, /@maskito\//] }),
  ],
});
