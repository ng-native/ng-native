const fs = require('node:fs');
const path = require('node:path');

const WINDOW_START = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;

const SCENE_DELEGATE = `
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
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
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
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
  if (!contents.includes(WINDOW_START)) {
    throw new Error(
      "[angular-native] AppDelegate.swift does not start React Native the way Expo's template does, so the scene life cycle was not adopted. Start it from a UIWindowSceneDelegate by hand.",
    );
  }
  return contents.replace(WINDOW_START, '') + SCENE_DELEGATE;
}

function projectRoot(config) {
  return path.resolve(config._internal?.projectRoot ?? process.cwd());
}

function configPlugins(config) {
  return require(require.resolve('expo/config-plugins', { paths: [projectRoot(config)] }));
}

function usesNativeRouter(manifest) {
  return Boolean(
    manifest?.dependencies?.['@ng-native/router'] ??
    manifest?.devDependencies?.['@ng-native/router'],
  );
}

function readManifest(config) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot(config), 'package.json'), 'utf8'));
  } catch {
    return null;
  }
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
    if (usesNativeRouter(readManifest(config))) {
      mod.modResults.UIViewControllerBasedStatusBarAppearance = true;
    }
    return mod;
  });
}

module.exports = withAngularNative;
module.exports.adoptScenes = adoptScenes;
module.exports.usesNativeRouter = usesNativeRouter;
