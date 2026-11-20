// Expo's runtime: its fetch, whose response streams a body, and URL, TextDecoderStream and
// structuredClone. Metro runs it before this file only when something imports it, and nothing
// else does in a release build, which would then get React Native's fetch, with no body.
import 'expo';
import { AppRegistry, Image, Platform, processColor } from 'react-native';
import { mount } from '@ng-native/platform';
import { currentConditions, deviceTokens, watchConditions } from '@ng-native/device';
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric';
import { App } from './app/app.ts';

registerPlatformComponents(Platform.OS);

/** What `mount` takes, for the app and for the tests that run inside it. */
const mountOptions = () => ({
  // Colours, as the integers the platform wants.
  processColor,
  // What `@media` resolves against. Without it every media query is false and a responsive
  // layout renders as its smallest case.
  conditions: currentConditions(),
  // Values only the device knows - the hairline width, which is a third of a point on a 3x
  // screen. Without it `1px` is what you get, and that is a visibly fat divider.
  tokens: deviceTokens(),
  // Turns a `require('./x.png')` into something native can load. Without it images are blank.
  resolveAssetSource: (value: unknown) => Image.resolveAssetSource(value as never),
});

if (process.env.EXPO_PUBLIC_DEVICE_TESTS) {
  // Metro was started for `vitest --project macos`: the test host, not the app.
  const { startDeviceTests } =
    require('@ng-native/testing/device/host') as typeof import('@ng-native/testing/device/host');
  startDeviceTests({
    mount: mountOptions(),
    // The host follows rotation, the theme and reduced motion as the app does.
    onMount: (app) => {
      const stopWatching = watchConditions(app.engine);
      app.applicationRef.onDestroy(stopWatching);
    },
  });
} else {
  AppRegistry.registerRunnable('main', ({ rootTag }) => {
    const app = mount(Number(rootTag), App, getFabricUIManager(), mountOptions());

    // Re-resolves the conditions when the device rotates or the theme changes. A rotation dirties
    // no component and no binding, so without this nothing re-renders and `dark:` stops following
    // the system switch. It stops with the app, which Android destroys when it recreates the
    // activity, so the app mounted in its place is the only one still watching.
    const stopWatching = watchConditions(app.engine);
    app.applicationRef.onDestroy(stopWatching);
  });
}
