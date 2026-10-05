import { ngNative } from '@ng-native/testing/vitest';
import { webCompat } from '@ng-native/web-compat/vitest';
import { defineConfig } from 'vitest/config';

// Compiles Angular for the tests the way Metro compiles it for the app. Tests run in Node against
// a fake of the native side: no simulator, no device.
export default defineConfig({
  // `webCompat` gives Spartan UI's import of `@ng-icons/core` the icons that draw natively.
  plugins: [webCompat(), ngNative({ inline: [/@spartan-ng/, /@angular\/cdk/] })],
});
