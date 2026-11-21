import { Platform } from 'react-native';
import { expect, it } from 'vitest';

// Runs inside the app, on real native views: `npx vitest --project macos`, and `ios` or `android`
// once the app has those projects. Render a component with `render` and `screen` from
// `@ng-native/testing/device`.
it('runs inside the app', () => {
  expect(['macos', 'ios', 'android']).toContain(Platform.OS);
});
