const path = require('node:path');

// The two statements in Expo's AppDelegate that open a window and start React Native in it, matched
// one at a time: a plugin that runs first can write between them, as @react-native-firebase/app
// does with FirebaseApp.configure().
const OPEN_WINDOW = /^[ \t]*window = UIWindow\(frame: UIScreen\.main\.bounds\)[ \t]*\r?\n/m;
const START_REACT_NATIVE =
  /^[ \t]*factory\.startReactNative\(\s*withModuleName: "main",\s*in: window,\s*launchOptions: launchOptions\)[ \t]*\r?\n/m;
const EMPTY_PLATFORM_CHECK = /^#if os\(iOS\) \|\| os\(tvOS\)\r?\n#endif\r?\n/m;

const SCENE_DELEGATE = `
// Once an app has scenes, iOS sends its links and life cycle events here and no longer to the app
// delegate, so each is handed on: Expo's modules subscribe to the app delegate's, and so does
// anything added to it.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var app: UIApplication { UIApplication.shared }
  private var appDelegate: AppDelegate? { app.delegate as? AppDelegate }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
      let appDelegate,
      let factory = appDelegate.reactNativeFactory
    else { return }

    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    if let activity = connectionOptions.userActivities.first {
      launchOptions[.userActivityDictionary] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }

    let window = UIWindow(windowScene: windowScene)
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
    self.window = window
    appDelegate.window = window

    // Without scenes, iOS followed a launch from a link by handing the link to the app delegate.
    self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    for activity in connectionOptions.userActivities {
      self.scene(scene, continue: activity)
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
      options[.sourceApplication] = context.options.sourceApplication
      options[.annotation] = context.options.annotation
      _ = appDelegate?.application(app, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate?.application(app, continue: userActivity, restorationHandler: { _ in })
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(app)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(app)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(app)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(app)
  }
}
`;

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: 'Default',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      },
    ],
  },
};

function adoptScenes(contents) {
  if (contents.includes('class SceneDelegate')) return contents;
  if (!OPEN_WINDOW.test(contents) || !START_REACT_NATIVE.test(contents)) {
    throw new Error(
      "[angular-native] AppDelegate.swift does not start React Native the way Expo's template does, so the scene life cycle was not adopted. Start it from a UIWindowSceneDelegate by hand.",
    );
  }
  return (
    contents
      .replace(OPEN_WINDOW, '')
      .replace(START_REACT_NATIVE, '')
      .replace(EMPTY_PLATFORM_CHECK, '') + SCENE_DELEGATE
  );
}

function configPlugins(config) {
  const root = config._internal?.projectRoot ?? process.cwd();
  return require(require.resolve('expo/config-plugins', { paths: [path.resolve(root)] }));
}

function withAngularNative(config) {
  const { withAppDelegate, withInfoPlist } = configPlugins(config);
  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language === 'swift') {
      mod.modResults.contents = adoptScenes(mod.modResults.contents);
    }
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = SCENE_MANIFEST;
    return mod;
  });
}

module.exports = withAngularNative;
module.exports.adoptScenes = adoptScenes;
