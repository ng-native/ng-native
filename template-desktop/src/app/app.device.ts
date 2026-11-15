import { Platform } from 'react-native';
import { expect, it } from 'vitest';

// Runs inside the app, on real AppKit views: `npx vitest --project macos`. Render a component
// with `render` and `screen` from `@ng-native/testing/device`.
it('runs on the Mac', () => {
  expect(Platform.OS).toBe('macos');
});
