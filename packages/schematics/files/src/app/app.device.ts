import { Platform } from 'react-native';
import { expect, it } from 'vitest';

// Runs inside the app, on real native views: `npx vitest --project ios` or `--project android`.
// Render a component with `render` and `screen` from `@ng-native/testing/device`.
it('runs on a phone', () => {
  expect(['ios', 'android']).toContain(Platform.OS);
});
