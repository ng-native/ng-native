import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { adoptScenes } = require('@ng-native/metro/app.plugin.cjs') as {
  adoptScenes(contents: string): string;
};

const expoAppDelegate = readFileSync(
  new URL('./fixtures/expo-app-delegate.swift', import.meta.url),
  'utf8',
);
// The same file after @react-native-firebase/app 26.4.0's plugin, which runs first as a dangerous
// mod and puts FirebaseApp.configure() in the middle of the lines that start React Native.
const firebaseAppDelegate = readFileSync(
  new URL('./fixtures/expo-app-delegate-firebase.swift', import.meta.url),
  'utf8',
);

/** The class a declaration opens, up to the next top-level class. */
function classBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  const end = source.indexOf('\nclass ', start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

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

  it('hands links on to the app delegate, which iOS stops calling once there are scenes', () => {
    const scene = classBody(adoptScenes(expoAppDelegate), 'class SceneDelegate');
    assert.match(scene, /appDelegate\?\.application\(app, open: context\.url, options: options\)/);
    assert.match(
      scene,
      /appDelegate\?\.application\(app, continue: userActivity, restorationHandler:/,
    );
    // Around the app delegate's own handlers, Expo's modules and whatever else was added there would
    // never see a link.
    assert.doesNotMatch(scene, /RCTLinkingManager/);
  });

  it('hands the links a scene opens with on to the app delegate as well, as iOS did at launch', () => {
    const scene = classBody(adoptScenes(expoAppDelegate), 'class SceneDelegate');
    assert.match(scene, /self\.scene\(scene, openURLContexts: connectionOptions\.urlContexts\)/);
    assert.match(scene, /self\.scene\(scene, continue: activity\)/);
  });

  it('hands the life cycle on to the app delegate, which iOS stops calling once there are scenes', () => {
    const scene = classBody(adoptScenes(expoAppDelegate), 'class SceneDelegate');
    for (const [event, handler] of [
      ['sceneDidBecomeActive', 'applicationDidBecomeActive'],
      ['sceneWillResignActive', 'applicationWillResignActive'],
      ['sceneWillEnterForeground', 'applicationWillEnterForeground'],
      ['sceneDidEnterBackground', 'applicationDidEnterBackground'],
    ]) {
      assert.match(
        scene,
        new RegExp(
          `func ${event}\\(_ scene: UIScene\\) \\{\\s*appDelegate\\?\\.${handler}\\(app\\)`,
        ),
      );
    }
  });

  it('adopts scenes after another plugin has written into the lines it replaces', () => {
    const appDelegate = classBody(adoptScenes(firebaseAppDelegate), 'class AppDelegate');
    assert.doesNotMatch(appDelegate, /UIWindow\(frame: UIScreen\.main\.bounds\)/);
    assert.doesNotMatch(appDelegate, /startReactNative/);
    // What the other plugin wrote stays where it put it, before React Native starts.
    assert.match(
      appDelegate,
      /FirebaseApp\.configure\(\)[\s\S]*return super\.application\(application, didFinishLaunchingWithOptions/,
    );
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
});
