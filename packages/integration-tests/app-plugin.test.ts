import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { adoptScenes, usesNativeRouter } = require('@ng-native/metro/app.plugin.cjs') as {
  adoptScenes(contents: string): string;
  usesNativeRouter(manifest: unknown): boolean;
};

const expoAppDelegate = readFileSync(
  new URL('./fixtures/expo-app-delegate.swift', import.meta.url),
  'utf8',
);

describe('the config plugin', () => {
  it("starts React Native from a scene delegate rather than Expo's own window", () => {
    const adopted = adoptScenes(expoAppDelegate);
    assert.doesNotMatch(adopted, /UIWindow\(frame: UIScreen\.main\.bounds\)/);
    assert.match(adopted, /class SceneDelegate: UIResponder, UIWindowSceneDelegate/);
    assert.match(adopted, /UIWindow\(windowScene: windowScene\)/);
    assert.match(adopted, /startReactNative\(withModuleName: "main", in: window/);
  });

  it('hands on the links a scene opens with and receives', () => {
    const adopted = adoptScenes(expoAppDelegate);
    assert.match(adopted, /launchOptions\[\.url\] = url/);
    assert.match(adopted, /openURLContexts/);
    assert.match(adopted, /continue userActivity: NSUserActivity/);
  });

  it('keeps the rest of the app delegate as Expo wrote it', () => {
    const adopted = adoptScenes(expoAppDelegate);
    assert.match(adopted, /class AppDelegate: ExpoAppDelegate/);
    assert.match(adopted, /class ReactNativeDelegate: ExpoReactNativeFactoryDelegate/);
    assert.match(adopted, /RCTLinkingManager\.application\(app, open: url, options: options\)/);
  });

  it('changes nothing the second time, as a repeated prebuild applies it again', () => {
    const once = adoptScenes(expoAppDelegate);
    assert.equal(adoptScenes(once), once);
  });

  it('refuses an app delegate it does not recognise, rather than leaving it half done', () => {
    assert.throws(
      () => adoptScenes('class AppDelegate: ExpoAppDelegate {}'),
      /scene life cycle was not adopted/,
    );
  });

  it('hands the status bar to view controllers only in an app whose screens can take it', () => {
    assert.equal(usesNativeRouter({ dependencies: { '@ng-native/router': '^0.1.0' } }), true);
    assert.equal(usesNativeRouter({ devDependencies: { '@ng-native/router': '^0.1.0' } }), true);
    assert.equal(usesNativeRouter({ dependencies: { '@ng-native/platform': '^0.1.0' } }), false);
    assert.equal(usesNativeRouter(null), false);
  });
});
