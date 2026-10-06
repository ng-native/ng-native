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

    AngularNativeStatusBar.install()
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

// iOS 27 makes UIApplication's status bar setters no-ops for an app built with its SDK, and React
// Native's status bar module, where every status bar call in JavaScript ends up, calls nothing else.
// So the bar is left to view controllers: the module's two setters are answered here, and each view
// controller iOS can ask about the bar answers with what was set. Until something is set, each
// answers as it would have, so a screen's own status bar props still count.
enum AngularNativeStatusBar {
  nonisolated(unsafe) private static var style: UIStatusBarStyle?
  nonisolated(unsafe) private static var hidden: Bool?
  nonisolated(unsafe) private static var animation = UIStatusBarAnimation.fade
  nonisolated(unsafe) private static var installed = false

  private typealias GetStyle = @convention(c) (UIViewController, Selector) -> Int
  private typealias GetHidden = @convention(c) (UIViewController, Selector) -> Bool
  private typealias GetChild = @convention(c) (UIViewController, Selector) -> UIViewController?

  static func install() {
    guard !installed else { return }
    installed = true

    let manager: AnyClass? = NSClassFromString("RCTStatusBarManager")
    replace(manager, NSSelectorFromString("setStyle:animated:")) { _ in
      let setStyle: @convention(block) (AnyObject, NSString?, Bool) -> Void = { _, name, animated in
        update(animated: animated) {
          style = ["light-content": .lightContent, "dark-content": .darkContent][name as String? ?? ""] ?? .default
        }
      }
      return imp_implementationWithBlock(setStyle)
    }
    replace(manager, NSSelectorFromString("setHidden:withAnimation:")) { _ in
      let setHidden: @convention(block) (AnyObject, Bool, NSString?) -> Void = { _, isHidden, name in
        let change = ["fade": UIStatusBarAnimation.fade, "slide": .slide][name as String? ?? ""] ?? .none
        update(animated: change != .none) {
          animation = change
          hidden = isHidden
        }
      }
      return imp_implementationWithBlock(setHidden)
    }

    // A screen and React Native's own modal are asked directly when presented full screen, not
    // through the root, and each overrides these methods itself.
    answer(NSClassFromString("RNSScreen"))
    answer(NSClassFromString("RCTFabricModalHostViewController"))
  }

  private static func update(animated: Bool, _ change: @escaping () -> Void) {
    DispatchQueue.main.async {
      change()
      let refresh = {
        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
          for window in scene.windows {
            adopt(window.rootViewController)
            var controller = window.rootViewController
            while let current = controller {
              current.setNeedsStatusBarAppearanceUpdate()
              controller = current.presentedViewController
            }
          }
        }
      }
      if animated { UIView.animate(withDuration: 0.3, animations: refresh) } else { refresh() }
    }
  }

  /// A window's root answers for everything under it, tab bar controllers included, so it gets
  /// overrides of its own, in a subclass made for its class the way key-value observing does it:
  /// UIKit never asks a controller that only inherits prefersStatusBarHidden.
  private static func adopt(_ controller: UIViewController?) {
    guard let controller, let type = object_getClass(controller) else { return }
    let name = NSStringFromClass(type)
    guard !name.hasPrefix("AngularNativeStatusBar_") else { return }
    var adopted: AnyClass? = NSClassFromString("AngularNativeStatusBar_" + name)
    if adopted == nil, let made = objc_allocateClassPair(type, "AngularNativeStatusBar_" + name, 0) {
      answer(made, asRoot: true)
      objc_registerClassPair(made)
      adopted = made
    }
    if let adopted { object_setClass(controller, adopted) }
  }

  private static func answer(_ type: AnyClass?, asRoot: Bool = false) {
    let styleSelector = #selector(getter: UIViewController.preferredStatusBarStyle)
    replace(type, styleSelector) { original in
      let get: @convention(block) (UIViewController) -> Int = { controller in
        if let style { return style.rawValue }
        return unsafeBitCast(original, to: GetStyle.self)(controller, styleSelector)
      }
      return imp_implementationWithBlock(get)
    }
    let hiddenSelector = #selector(getter: UIViewController.prefersStatusBarHidden)
    replace(type, hiddenSelector) { original in
      let get: @convention(block) (UIViewController) -> Bool = { controller in
        if let hidden { return hidden }
        return unsafeBitCast(original, to: GetHidden.self)(controller, hiddenSelector)
      }
      return imp_implementationWithBlock(get)
    }
    let animationSelector = #selector(getter: UIViewController.preferredStatusBarUpdateAnimation)
    replace(type, animationSelector) { original in
      let get: @convention(block) (UIViewController) -> Int = { controller in
        if hidden != nil { return animation.rawValue }
        return unsafeBitCast(original, to: GetStyle.self)(controller, animationSelector)
      }
      return imp_implementationWithBlock(get)
    }
    guard asRoot else { return }
    // Otherwise the question goes on to a child that knows nothing of what was set.
    for (selector, isSet) in [
      (#selector(getter: UIViewController.childForStatusBarStyle), { style != nil }),
      (#selector(getter: UIViewController.childForStatusBarHidden), { hidden != nil }),
    ] {
      replace(type, selector) { original in
        let get: @convention(block) (UIViewController) -> UIViewController? = { controller in
          if isSet() { return nil }
          return unsafeBitCast(original, to: GetChild.self)(controller, selector)
        }
        return imp_implementationWithBlock(get)
      }
    }
  }

  /// Swaps a method's implementation, or overrides it when the class only inherits it, so a
  /// superclass is never changed through a subclass.
  private static func replace(_ type: AnyClass?, _ selector: Selector, with make: (IMP) -> IMP) {
    guard let type, let method = class_getInstanceMethod(type, selector) else { return }
    let replacement = make(method_getImplementation(method))
    if !class_addMethod(type, selector, replacement, method_getTypeEncoding(method)) {
      method_setImplementation(method, replacement)
    }
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

function adoptInfoPlist(plist) {
  return {
    ...plist,
    UIApplicationSceneManifest: SCENE_MANIFEST,
    // What iOS and react-native-screens need to ask view controllers about the bar.
    UIViewControllerBasedStatusBarAppearance: true,
  };
}

// The call in Expo's MainApplication that loads React Native and gives its feature flags the
// values of the app's release level.
const LOAD_REACT_NATIVE = /^[ \t]*loadReactNative\(this\)[ \t]*\r?\n/m;

const LAYOUT_ANIMATIONS = `    // React Native leaves layout animations off on Android, where Fabric then never hands a commit
    // to the driver that plays them and every layout change snaps. Its flags are set once, by
    // loadReactNative above, so this replaces them with the same ones and this one turned on.
    com.facebook.react.internal.featureflags.ReactNativeFeatureFlags.dangerouslyForceOverride(
      object : com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider by
        when (com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.releaseLevel) {
          com.facebook.react.common.ReleaseLevel.EXPERIMENTAL ->
            com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Experimental_Android()
          com.facebook.react.common.ReleaseLevel.CANARY ->
            com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Canary_Android()
          else ->
            com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android()
        } {
        override fun enableLayoutAnimationsOnAndroid(): Boolean = true
      }
    )
`;

function enableLayoutAnimations(contents) {
  if (contents.includes('enableLayoutAnimationsOnAndroid')) return contents;
  if (!LOAD_REACT_NATIVE.test(contents)) {
    throw new Error(
      "[angular-native] MainApplication.kt does not load React Native the way Expo's template does, so layout animations were not turned on for Android. Override the enableLayoutAnimationsOnAndroid feature flag by hand.",
    );
  }
  return contents.replace(LOAD_REACT_NATIVE, (line) => line + LAYOUT_ANIMATIONS);
}

function configPlugins(config) {
  const root = config._internal?.projectRoot ?? process.cwd();
  return require(require.resolve('expo/config-plugins', { paths: [path.resolve(root)] }));
}

/** Whether the app asked for layout animations on Android: `{ android: { layoutAnimations } }`. */
function wantsLayoutAnimations(options) {
  const asked = options?.android?.layoutAnimations;
  if (asked !== undefined && typeof asked !== 'boolean') {
    throw new Error(
      `[angular-native] android.layoutAnimations must be true or false, and is ${JSON.stringify(asked)}.`,
    );
  }
  return asked === true;
}

function withAngularNative(config, options) {
  const { withAppDelegate, withInfoPlist, withMainApplication } = configPlugins(config);
  if (wantsLayoutAnimations(options)) {
    config = withMainApplication(config, (mod) => {
      if (mod.modResults.language !== 'kt') {
        throw new Error(
          '[angular-native] MainApplication is not Kotlin, so layout animations were not turned on for Android. Override the enableLayoutAnimationsOnAndroid feature flag by hand.',
        );
      }
      mod.modResults.contents = enableLayoutAnimations(mod.modResults.contents);
      return mod;
    });
  }
  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language === 'swift') {
      mod.modResults.contents = adoptScenes(mod.modResults.contents);
    }
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults = adoptInfoPlist(mod.modResults);
    return mod;
  });
}

module.exports = withAngularNative;
module.exports.adoptScenes = adoptScenes;
module.exports.adoptInfoPlist = adoptInfoPlist;
module.exports.enableLayoutAnimations = enableLayoutAnimations;
