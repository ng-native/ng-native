import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { adoptScenes, adoptInfoPlist, enableLayoutAnimations } =
  require('@ng-native/metro/app.plugin.cjs') as {
    adoptScenes(contents: string): string;
    adoptInfoPlist(plist: Record<string, unknown>): Record<string, unknown>;
    enableLayoutAnimations(contents: string): string;
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
// The MainApplication.kt `expo prebuild` writes for Expo SDK 57.
const expoMainApplication = readFileSync(
  new URL('./fixtures/expo-main-application.kt', import.meta.url),
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

  it("hands the status bar to view controllers, since iOS 27 ignores UIApplication's", () => {
    // What `expo prebuild` writes, and what React Native's own status bar module requires.
    const plist = adoptInfoPlist({ UIViewControllerBasedStatusBarAppearance: false });
    assert.equal(plist['UIViewControllerBasedStatusBarAppearance'], true);
  });

  it("answers React Native's status bar calls itself, installed before React Native starts", () => {
    const adopted = adoptScenes(expoAppDelegate);
    const scene = classBody(adopted, 'class SceneDelegate');
    assert.match(scene, /AngularNativeStatusBar\.install\(\)[\s\S]*factory\.startReactNative/);
    // RCTStatusBarManager's two setters, which call the APIs iOS 27 made no-ops.
    assert.match(adopted, /"setStyle:animated:"/);
    assert.match(adopted, /"setHidden:withAnimation:"/);
  });

  it('has every view controller iOS asks about the bar answer with what the app set', () => {
    const adopted = adoptScenes(expoAppDelegate);
    // A screen and React Native's own modal are asked directly when presented full screen, rather
    // than through the root, and each overrides the methods itself.
    assert.match(adopted, /answer\(NSClassFromString\("RNSScreen"\)\)/);
    assert.match(adopted, /answer\(NSClassFromString\("RCTFabricModalHostViewController"\)\)/);
    // The root gets a subclass of its own: UIKit never asks a controller that only inherits
    // prefersStatusBarHidden, so changing UIViewController's own method hides nothing.
    assert.match(adopted, /adopt\(window\.rootViewController\)/);
    assert.match(adopted, /objc_allocateClassPair/);
    assert.doesNotMatch(adopted, /answer\(UIViewController\.self/);
  });

  // React Native 0.86 ships `enableLayoutAnimationsOnAndroid` false, and with it off Fabric never
  // hands a commit to the layout animation driver: `LayoutAnimation` configures an animation that
  // nothing plays, and every layout change snaps.
  it('turns layout animations on for Android, after React Native has loaded its own flags', () => {
    const enabled = enableLayoutAnimations(expoMainApplication);
    assert.match(
      enabled,
      /loadReactNative\(this\)\n[\s\S]*dangerouslyForceOverride\([\s\S]*override fun enableLayoutAnimationsOnAndroid\(\): Boolean = true[\s\S]*ApplicationLifecycleDispatcher\.onApplicationCreate\(this\)/,
    );
  });

  it("keeps every other flag as the app's release level set it", () => {
    // The flags `loadReactNative` chose for the release level are the ones delegated to, so an
    // app on the canary or experimental level keeps what that level turns on.
    const enabled = enableLayoutAnimations(expoMainApplication);
    assert.match(
      enabled,
      /ReactNativeFeatureFlagsProvider by\s+when \(com\.facebook\.react\.defaults\.DefaultNewArchitectureEntryPoint\.releaseLevel\)/,
    );
    for (const level of ['Experimental', 'Canary', 'Stable']) {
      assert.match(
        enabled,
        new RegExp(`ReactNativeFeatureFlagsOverrides_RNOSS_${level}_Android\\(\\)`),
      );
    }
  });

  it('leaves the rest of the application class as Expo wrote it', () => {
    const enabled = enableLayoutAnimations(expoMainApplication);
    const added = enabled.length - expoMainApplication.length;
    const at = enabled.indexOf('    // React Native leaves layout animations off');
    assert.equal(enabled.slice(0, at) + enabled.slice(at + added), expoMainApplication);
  });

  it('names every class in full, so it compiles whatever the file imports', () => {
    const bare = enableLayoutAnimations(
      'class MainApplication {\n  fun onCreate() {\n    loadReactNative(this)\n  }\n}\n',
    );
    const added = bare.slice(bare.indexOf('loadReactNative(this)\n') + 22, bare.indexOf('  }\n}'));
    const code = added.replace(/^\s*\/\/.*$/gm, '');
    assert.deepEqual(
      (code.match(/(?<![.\w])[A-Z]\w+/g) ?? []).filter((name) => name !== 'Boolean'),
      [],
    );
  });

  it('turns layout animations on once, as a repeated prebuild applies it again', () => {
    const once = enableLayoutAnimations(expoMainApplication);
    assert.equal(enableLayoutAnimations(once), once);
  });

  it('refuses an application class it does not recognise, rather than leaving them off', () => {
    assert.throws(
      () => enableLayoutAnimations('class MainApplication : Application() {}'),
      /layout animations were not turned on/,
    );
  });

  /** The plugin as `expo prebuild` runs it, and its Android mod over one application class. */
  function prebuild(options?: object) {
    type Mod = (config: object) => Promise<{ modResults: { contents: string } }>;
    const plugin = require('@ng-native/metro/app.plugin.cjs') as (
      config: object,
      options?: object,
    ) => { mods: { android?: { mainApplication?: Mod } } };
    const root = fileURLToPath(new URL('.', import.meta.url));
    const config = plugin({ name: 'app', slug: 'app', _internal: { projectRoot: root } }, options);
    const mod = config.mods.android?.mainApplication;
    return {
      mod,
      mainApplication: async (language: string, contents: string) =>
        (
          await mod!({
            ...config,
            modResults: { language, contents, path: 'MainApplication' },
            modRequest: { platform: 'android', modName: 'mainApplication', projectRoot: root },
          })
        ).modResults.contents,
    };
  }

  it('leaves the Android project alone unless asked, whatever its application class holds', () => {
    // No mod at all: a prebuild writes what it writes without the plugin, and an application
    // class the plugin would not recognise is never read, so it cannot be refused either.
    assert.equal(prebuild().mod, undefined);
    assert.equal(prebuild({}).mod, undefined);
    assert.equal(prebuild({ android: {} }).mod, undefined);
    assert.equal(prebuild({ android: { layoutAnimations: false } }).mod, undefined);
  });

  it('turns layout animations on in the application class a prebuild hands it, when asked', async () => {
    const { mainApplication } = prebuild({ android: { layoutAnimations: true } });
    const enabled = await mainApplication('kt', expoMainApplication);
    assert.equal(enabled, enableLayoutAnimations(expoMainApplication));
    assert.notEqual(enabled, expoMainApplication);
    // A second prebuild reads the file the first one wrote.
    assert.equal(await mainApplication('kt', enabled), enabled);
  });

  it('fails the prebuild when asked and the application class is not one it can turn them on in', async () => {
    const { mainApplication } = prebuild({ android: { layoutAnimations: true } });
    await assert.rejects(
      mainApplication('kt', 'class MainApplication : Application() {}'),
      /layout animations were not turned on/,
    );
    await assert.rejects(
      mainApplication('java', 'public class MainApplication {}'),
      /layout animations were not turned on/,
    );
  });

  it('refuses an option that is not true or false, rather than reading it as off', () => {
    assert.throws(
      () => prebuild({ android: { layoutAnimations: 'true' } }),
      /android\.layoutAnimations must be true or false/,
    );
  });
});
