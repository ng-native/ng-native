// Expo's runtime: its fetch, whose response streams a body, and URL, TextDecoderStream and
// structuredClone. Metro runs it before this file only when something imports it, and nothing
// else does in a release build, which would then get React Native's fetch, with no body.
import 'expo';
import { AppRegistry, Image, Platform, processColor } from 'react-native';
import { mount } from '@ng-native/platform';
import { currentConditions, deviceTokens, watchConditions } from '@ng-native/device';
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric';
import { registerExpoUiViews, registerExpoView } from '@ng-native/expo';
import { App } from './app/app.ts';
import { appConfig } from './app/app.config.ts';
// The generated stylesheet. The Tailwind CLI writes CSS; the Metro config compiles it into this
// module, because Expo's transform worker turns a `.css` import into an empty module on native.
import tailwind from '../.angular-native/app.tailwind.js';

registerPlatformComponents(Platform.OS);

// expo-image's Fabric view, under an element name of our choosing. Its React component is
// skipped entirely; the props the component would have computed are written in the templates.
registerExpoView('expo-image', 'ExpoImage');
// The seek slider on the Now Playing screen is a real SwiftUI/Compose control.
registerExpoUiViews(Platform.OS as 'ios' | 'android');

AppRegistry.registerRunnable('main', ({ rootTag }: { rootTag: number | string }) => {
  const app = mount(Number(rootTag), App, getFabricUIManager(), {
    processColor,
    globalStyles: tailwind,
    conditions: currentConditions(),
    tokens: deviceTokens(),
    resolveAssetSource: (value) => Image.resolveAssetSource(value as never),
    ...appConfig,
  });

  // A theme switch changes what `dark:` matches, and nothing in the app is dirty when it happens.
  watchConditions(app.engine);
});
