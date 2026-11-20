import { Platform } from 'react-native';
import { expect, it } from 'vitest';

// Runs inside the app, on real native views: AppKit with `npx vitest --project macos`, GTK with
// `npx vitest --project linux`. Render a component with `render` and `screen` from
// `@ng-native/testing/device`.
it('runs on a desktop host', () => {
  expect(['macos', 'linux']).toContain(Platform.OS);
});
