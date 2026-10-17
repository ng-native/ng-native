// Expo's runtime: its fetch, URL and the rest. Metro runs it before this file only when something
// imports it.
import 'expo';
import { AppRegistry, Platform, processColor } from 'react-native';
import { mount } from '@ng-native/platform';
import { currentConditions, deviceTokens, watchConditions } from '@ng-native/device';
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric';
import { provideNativeScript } from '@ng-native/nativescript';
import { App } from './app/app.ts';

registerPlatformComponents(Platform.OS);

AppRegistry.registerRunnable('main', ({ rootTag }: { rootTag: number | string }) => {
  const app = mount(Number(rootTag), App, getFabricUIManager(), {
    processColor,
    conditions: currentConditions(),
    tokens: deviceTokens(),
    // SceneKit is not linked into the app, so it is loaded for the torus.
    providers: [provideNativeScript({ frameworks: ['SceneKit'] })],
  });
  watchConditions(app.engine);
});
