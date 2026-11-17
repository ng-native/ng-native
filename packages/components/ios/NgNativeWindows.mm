#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#import <React/RCTSurfaceHostingProxyRootView.h>
#import <React/RCTSurfaceProtocol.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>

#import "NgNativeResponderHooks.h"
#import "NgNativeSceneKeys.h"

/**
 The `NgNativeWindows` module on an iPad (`NativeWindows` in @ng-native/device): each of the app's
 windows is a UIWindowScene with a surface of its own, on React Native's one host, so every window
 shares the one runtime and the one Angular app.

 - `multipleWindows` is true on an iPad whose Info.plist supports several scenes (the config
   plugin's `ios.multipleWindows`). Elsewhere it is false, and JavaScript leaves the module alone.
 - The scene the app launched in shows the surface React Native started with, which the app keeps
   for itself and never renders on. The first window opened takes that scene, with a surface of
   its own; each later one asks iPadOS for a new scene through `requestSceneSessionActivation`,
   with the `dev.ngnative.window` activity, which the app delegate's configuration hook gives this
   file's scene delegate. `open` resolves the surface's id once the surface runs.
 - `close` stops the surface and destroys the scene's session, `focus` activates it, and
   `setTitle` names the scene in the app switcher and the window's title.
 - iPadOS asks no app before it closes a window, so there is no `closeRequest`: a scene the user
   closes sends `closed` once iPadOS discards its session. A scene iPadOS only disconnects, to
   reclaim memory in the background, keeps its window and surface, and shows them again when it
   reconnects. iOS ends an app itself, so `quit` and `answerQuit` do nothing and no `quitRequest`
   is ever sent.
 - Events on `ngNativeWindows`: `focus` as a scene becomes active, `resize` as a window's size
   changes, `closed`, `newWindow` for a scene the user made (New Window, or the app opened again
   with none), and `reopen` for a window's scene that connects with no `open` waiting for it (one
   asked for before a reload). Each waits five seconds for the app to open a window in it. The app
   answers `newWindow` with its main window, and where that is open already it brings it to the
   front with `focus`, which closes the scene the user made.
 - A reload keeps the windows with a key for the reloaded app to open again, for five seconds from
   the latest reload, and closes the rest, as the macOS host does. An `open` still waiting for its
   scene resolves null.
 - A relaunch: iPadOS keeps the scene sessions and restores the one in front, and the app opens its
   windows again by key (`AppWindows` keeps them). The key of the window each session had is kept
   in the app's user defaults, so `open` with a key takes the scene kept for it: the restored one,
   or a hidden one, where the window shows once iPadOS connects that scene. The scene the app
   launched in waits five seconds for its own window. A scene connecting after the app has
   launched comes here even when it was made for the app's scene delegate, so React Native never
   starts a second time.
 */

static NSString *const WindowActivity = @"dev.ngnative.window";
static NSString *const WindowRunnable = @"NgNativeWindow";
// In the app's user defaults: the key of the window each scene session had, by its identifier.
static NSString *const KeptKeys = @"dev.ngnative.windowKeys";
static const NSTimeInterval ClaimSeconds = 5;

/** What JavaScript is handed for React Native's host: no header of its own is needed. */
@protocol NgNativeReactHost <NSObject>
- (id<RCTSurfaceProtocol>)createSurfaceWithModuleName:(NSString *)moduleName initialProperties:(NSDictionary *)properties;
@end

static __weak id<NgNativeReactHost> reactHost;

/** A window's root view: its surface, which says when it first runs and when its size changes. */
@interface NgNativeWindowRootView : RCTSurfaceHostingProxyRootView
@property (nonatomic, copy, nullable) void (^onRunning)(void);
@property (nonatomic, copy, nullable) void (^onResize)(CGSize size, CGFloat scale);
- (void)ngn_reportSizeAgain;
@end

@implementation NgNativeWindowRootView {
  CGSize _reported;
  // Sizes are sent once the surface runs, when the app has the window: one sooner goes unheard.
  BOOL _ran;
}

- (void)surface:(id<RCTSurfaceProtocol>)surface didChangeStage:(RCTSurfaceStage)stage
{
  [super surface:surface didChangeStage:stage];
  if (!RCTSurfaceStageIsRunning(stage)) {
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    [self ngn_ran];
  });
}

- (void)ngn_ran
{
  void (^running)(void) = self.onRunning;
  self.onRunning = nil;
  _ran = YES;
  if (running) {
    running();
  }
  [self ngn_reportSize];
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  [self ngn_reportSize];
}

/** Send the size again, though it has not changed: a new mount on the surface has not heard it. */
- (void)ngn_reportSizeAgain
{
  _reported = CGSizeZero;
  [self ngn_reportSize];
}

- (void)ngn_reportSize
{
  CGSize size = self.bounds.size;
  if (!_ran || CGSizeEqualToSize(size, _reported) || size.width <= 0 || size.height <= 0 || self.onResize == nil) {
    return;
  }
  _reported = size;
  self.onResize(size, self.window.screen.scale ?: UIScreen.mainScreen.scale);
}

@end

/** One open window. */
@interface NgNativeSceneWindow : NSObject
@property (nonatomic) NSInteger surface;
@property (nonatomic, weak) UIWindowScene *scene;
// The scene's session, which outlives a disconnect: the window shows again when it reconnects.
@property (nonatomic, strong) UISceneSession *session;
// Whether the scene is this file's; the scene the app launched in is the app's.
@property (nonatomic) BOOL own;
// The window, for a scene of this file's while it is connected; the app's scene keeps its own.
@property (nonatomic, strong, nullable) UIWindow *window;
@property (nonatomic, strong) NgNativeWindowRootView *rootView;
@property (nonatomic, copy, nullable) NSString *key;
@property (nonatomic, copy) NSString *title;
// A reload kept it for the reloaded app to open again.
@property (nonatomic) BOOL kept;
@end

@implementation NgNativeSceneWindow
@end

/** A scene with no window yet: one the user made, or one iPadOS restored. */
@interface NgNativeWaitingScene : NSObject
@property (nonatomic, weak) UIWindowScene *scene;
@property (nonatomic, strong) UIWindow *window;
// New Window, or the app opened again: closed once the app answers it with a window it has open.
@property (nonatomic) BOOL userMade;
@end

@implementation NgNativeWaitingScene
@end

@class NgNativeWindows;

/** The windows, kept across reloads, which make a new module. Main thread. */
@interface NgNativeWindowHost : NSObject
@property (nonatomic, weak, nullable) NgNativeWindows *module;
+ (instancetype)shared;
- (void)send:(NSDictionary *)event;
- (void)discarded:(NSSet<UISceneSession *> *)sessions;
- (void)connected:(UIWindowScene *)scene options:(UISceneConnectionOptions *)options;
@end

@interface NgNativeWindows : NSObject <RCTBridgeModule, RCTInvalidating>
- (void)send:(NSDictionary *)event;
@end

/** The scene delegate of a window this file opens. */
@interface NgNativeWindowSceneDelegate : UIResponder <UIWindowSceneDelegate>
/** Whether the scene is the app's own: a window's scene iPadOS restored before the app launched. */
- (BOOL)hostsApp;
@end

#pragma mark - Hooks

static Class appSceneDelegateClass(void);
// On an app scene delegate that handed its scene to the windows: the scene is a window's, not the app's.
static char HandedToWindows;

static BOOL multipleWindows(void)
{
  return UIDevice.currentDevice.userInterfaceIdiom == UIUserInterfaceIdiomPad &&
      UIApplication.sharedApplication.supportsMultipleScenes;
}

static BOOL isWindowActivity(NSSet<NSUserActivity *> *activities)
{
  for (NSUserActivity *activity in activities) {
    if ([activity.activityType isEqualToString:WindowActivity]) {
      return YES;
    }
  }
  return NO;
}

/**
 Whether `scene` is the app's own: Expo's scene delegate has it, unless it handed it to the
 windows, or this file's handed it to one because iPadOS restored it before the app launched.
 */
static BOOL isAppScene(UIScene *scene)
{
  id<UISceneDelegate> delegate = scene.delegate;
  if (delegate == nil || objc_getAssociatedObject(delegate, &HandedToWindows) != nil) {
    return NO;
  }
  return ![delegate isKindOfClass:[NgNativeWindowSceneDelegate class]] ||
      [(NgNativeWindowSceneDelegate *)delegate hostsApp];
}

/** Whether a scene of the app's own is connected: the app has launched. */
static BOOL appSceneConnected(void)
{
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (isAppScene(scene)) {
      return YES;
    }
  }
  return NO;
}

/**
 The app delegate's scene configurations: a window's scene, and once the app has launched any
 other new scene (New Window, or the app opened again after its first scene closed), is this
 file's; the first is the app's, as before. React Native starts once, in that first scene.
 */
static void hookSceneConfiguration(Class delegate)
{
  SEL selector = @selector(application:configurationForConnectingSceneSession:options:);
  NgNativeHook(delegate, selector, "@@:@@@", ^id(IMP previous) {
    return ^UISceneConfiguration *(id self, UIApplication *app, UISceneSession *session, UISceneConnectionOptions *options) {
      if (multipleWindows() && (isWindowActivity(options.userActivities) || reactHost != nil || appSceneConnected())) {
        UISceneConfiguration *configuration = [UISceneConfiguration configurationWithName:nil
                                                                              sessionRole:session.role];
        configuration.delegateClass = [NgNativeWindowSceneDelegate class];
        return configuration;
      }
      if (previous != NULL) {
        return ((UISceneConfiguration * (*)(id, SEL, id, id, id)) previous)(self, selector, app, session, options);
      }
      return session.configuration;
    };
  });
}

/**
 The app's scene delegate, connecting a scene once React Native runs: iPadOS keeps the delegate a
 session was made with, so the scene the app launched in, connecting again, or restored after
 another window's scene launched the app, comes here. It goes to the windows, as this file's
 scenes do, rather than starting React Native a second time.
 */
static void hookAppSceneConnection(void)
{
  Class appDelegate = appSceneDelegateClass();
  if (appDelegate == Nil || appDelegate == [NgNativeWindowSceneDelegate class]) {
    return;
  }
  SEL selector = @selector(scene:willConnectToSession:options:);
  NgNativeHook(appDelegate, selector, "v@:@@@", ^id(IMP previous) {
    return ^(id<UIWindowSceneDelegate> self, UIScene *scene, UISceneSession *session, UISceneConnectionOptions *options) {
      if (!multipleWindows() || reactHost == nil || ![scene isKindOfClass:[UIWindowScene class]]) {
        if (previous != NULL) {
          ((void (*)(id, SEL, id, id, id))previous)(self, selector, scene, session, options);
        }
        return;
      }
      objc_setAssociatedObject(self, &HandedToWindows, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      [[NgNativeWindowHost shared] connected:(UIWindowScene *)scene options:options];
      // A link that opened this scene, or an activity handed to it, goes where the delegate sends one.
      if (options.URLContexts.count > 0 && [self respondsToSelector:@selector(scene:openURLContexts:)]) {
        [self scene:scene openURLContexts:options.URLContexts];
      }
      for (NSUserActivity *activity in options.userActivities) {
        if (![activity.activityType isEqualToString:WindowActivity] &&
            [self respondsToSelector:@selector(scene:continueUserActivity:)]) {
          [self scene:scene continueUserActivity:activity];
        }
      }
    };
  });
}

/** The app delegate's discarded sessions: the scenes the user closed. */
static void hookSceneDiscard(Class delegate)
{
  SEL selector = @selector(application:didDiscardSceneSessions:);
  NgNativeHook(delegate, selector, "v@:@@", ^id(IMP previous) {
    return ^(id self, UIApplication *app, NSSet<UISceneSession *> *sessions) {
      if (previous != NULL) {
        ((void (*)(id, SEL, id, id))previous)(self, selector, app, sessions);
      }
      [[NgNativeWindowHost shared] discarded:sessions];
    };
  });
}

@implementation NgNativeWindowSceneDelegate (Install)

+ (void)load
{
  // React Native's host, as it starts: every window's surface is made on it.
  Class host = NSClassFromString(@"RCTHost");
  if (host != Nil) {
    NgNativeHook(host, @selector(start), "v@:", ^id(IMP previous) {
      return ^(id self) {
        reactHost = self;
        if (previous != NULL) {
          ((void (*)(id, SEL))previous)(self, @selector(start));
        }
      };
    });
  }
  // The app delegate's scene configurations, hooked as it becomes the delegate: UIApplication reads
  // which methods its delegate has then, and a method added later is never called.
  NgNativeHook([UIApplication class], @selector(setDelegate:), "v@:@", ^id(IMP previous) {
    return ^(UIApplication *self, id<UIApplicationDelegate> delegate) {
      static dispatch_once_t once;
      if (delegate != nil) {
        dispatch_once(&once, ^{
          hookSceneConfiguration([delegate class]);
          hookSceneDiscard([delegate class]);
          hookAppSceneConnection();
        });
      }
      if (previous != NULL) {
        ((void (*)(id, SEL, id))previous)(self, @selector(setDelegate:), delegate);
      }
    };
  });
}

@end

#pragma mark - The host

@implementation NgNativeWindowHost {
  NSMutableDictionary<NSNumber *, NgNativeSceneWindow *> *_windows;
  NSMutableArray<NgNativeWaitingScene *> *_waiting;
  // What `open` is waiting on for a scene iPadOS is connecting, by the request's id.
  NSMutableDictionary<NSString *, void (^)(UIWindowScene *_Nullable)> *_requests;
  // The scene the app launched in, until a window takes it, and the root it showed then.
  UIViewController *_launchRoot;
  BOOL _launchTaken;
  BOOL _attached;
  // How many times the app has reloaded: a reload's claim time ends only its own windows.
  NSUInteger _reloads;
}

+ (instancetype)shared
{
  static NgNativeWindowHost *shared;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    shared = [NgNativeWindowHost new];
  });
  return shared;
}

- (instancetype)init
{
  if (self = [super init]) {
    _windows = [NSMutableDictionary dictionary];
    _waiting = [NSMutableArray array];
    _requests = [NSMutableDictionary dictionary];
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:self selector:@selector(sceneActivated:) name:UISceneDidActivateNotification object:nil];
    [center addObserver:self selector:@selector(sceneDeactivating:) name:UISceneWillDeactivateNotification object:nil];
    [center addObserver:self selector:@selector(sceneDisconnected:) name:UISceneDidDisconnectNotification object:nil];
  }
  return self;
}

- (void)send:(NSDictionary *)event
{
  [self.module send:event];
}

/** A module starts. After the first, the app has reloaded. */
- (void)attach:(NgNativeWindows *)module
{
  self.module = module;
  if (!_attached) {
    _attached = YES;
    [self forgetClosedSessions:nil];
    return;
  }
  // The app that asked for these scenes is gone: each resolves null, and its scene waits for the
  // reloaded app as one restored would.
  NSArray<void (^)(UIWindowScene *_Nullable)> *requests = _requests.allValues;
  [_requests removeAllObjects];
  for (void (^waitingOn)(UIWindowScene *_Nullable) in requests) {
    waitingOn(nil);
  }
  for (NgNativeSceneWindow *window in _windows.allValues) {
    if (window.key != nil) {
      window.kept = YES;
    } else {
      [self closeWindow:window destroy:YES];
    }
  }
  NSUInteger reload = ++_reloads;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(ClaimSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    // A later reload's windows have the whole claim time from that reload.
    if (reload != self->_reloads) {
      return;
    }
    for (NgNativeSceneWindow *window in self->_windows.allValues) {
      if (window.kept) {
        [self closeWindow:window destroy:YES];
      }
    }
  });
}

#pragma mark Keys

/** The key of the window each scene session had, by the session's identifier. */
- (NSDictionary *)kept
{
  return [NSUserDefaults.standardUserDefaults dictionaryForKey:KeptKeys] ?: @{};
}

- (nullable NSString *)keyOf:(UISceneSession *)session
{
  return NgNativeSessionKey(self.kept, session.persistentIdentifier);
}

/** Mark the session's scene as a window's, with `key`. */
- (void)keep:(UISceneSession *)session key:(nullable NSString *)key
{
  NSDictionary *kept = NgNativeKeepSession(self.kept, session.persistentIdentifier, key);
  [NSUserDefaults.standardUserDefaults setObject:kept forKey:KeptKeys];
}

/** Forget the sessions iPadOS no longer keeps, and those in `discarded`. */
- (void)forgetClosedSessions:(nullable NSSet<UISceneSession *> *)discarded
{
  NSMutableSet<NSString *> *open = [NSMutableSet set];
  for (UISceneSession *session in UIApplication.sharedApplication.openSessions) {
    [open addObject:session.persistentIdentifier];
  }
  for (UISceneSession *session in discarded) {
    [open removeObject:session.persistentIdentifier];
  }
  NSDictionary *kept = NgNativeKeepOpenSessions(self.kept, open);
  [NSUserDefaults.standardUserDefaults setObject:kept forKey:KeptKeys];
}

- (nullable NgNativeSceneWindow *)windowForScene:(UIScene *)scene
{
  for (NgNativeSceneWindow *window in _windows.allValues) {
    if (window.scene == scene) {
      return window;
    }
  }
  return nil;
}

- (nullable NgNativeSceneWindow *)windowForSession:(UISceneSession *)session
{
  for (NgNativeSceneWindow *window in _windows.allValues) {
    if ([window.session.persistentIdentifier isEqualToString:session.persistentIdentifier]) {
      return window;
    }
  }
  return nil;
}

#pragma mark Opening

- (void)open:(NSDictionary *)request resolve:(void (^)(id _Nullable surface))resolve
{
  NSString *key = [request[@"key"] isKindOfClass:[NSString class]] ? request[@"key"] : nil;
  NSString *title = [request[@"title"] isKindOfClass:[NSString class]] ? request[@"title"] : @"";
  if (reactHost == nil || !multipleWindows()) {
    resolve(nil);
    return;
  }
  // A window a reload kept goes back to the app that opens its key again.
  for (NgNativeSceneWindow *window in _windows.allValues) {
    if (key != nil && window.kept && [window.key isEqualToString:key]) {
      window.kept = NO;
      window.title = title;
      window.scene.title = title;
      resolve(@(window.surface));
      // The reloaded app keeps a size heard before its mount on the surface, and hands it over.
      [window.rootView ngn_reportSizeAgain];
      return;
    }
  }
  // The scene the app launched in or one waiting for a window, the one kept for this key before
  // the others, then the hidden scene of the window with this key, then a new one.
  UIWindowScene *launch = _launchTaken ? nil : [self launchScene];
  [_waiting filterUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NgNativeWaitingScene *waiting, id _) {
    return waiting.scene != nil;
  }]];
  NSMutableArray *keys = [NSMutableArray array];
  if (launch != nil) {
    [keys addObject:[self keyOf:launch.session] ?: NSNull.null];
  }
  for (NgNativeWaitingScene *waiting in _waiting) {
    [keys addObject:[self keyOf:waiting.scene.session] ?: NSNull.null];
  }
  NSUInteger chosen = NgNativeSceneForKey(keys, key);
  if (launch != nil && chosen == 0) {
    _launchTaken = YES;
    UIWindow *window = launch.keyWindow ?: launch.windows.firstObject;
    _launchRoot = window.rootViewController;
    [self show:window scene:launch session:launch.session own:NO key:key title:title resolve:resolve];
    return;
  }
  if (launch != nil && [self keyOf:launch.session] != nil) {
    // iPadOS restored the app in another window's scene: it waits for that window, as a scene
    // waiting for one does, and goes if the app does not open it.
    [self dropLaunchSceneUnlessTaken:launch];
  }
  if (chosen != NSNotFound) {
    NgNativeWaitingScene *waiting = _waiting[chosen - (launch != nil ? 1 : 0)];
    [_waiting removeObject:waiting];
    [self show:waiting.window scene:waiting.scene session:waiting.scene.session own:YES key:key title:title resolve:resolve];
    return;
  }
  UISceneSession *hidden = [self hiddenSessionFor:key];
  if (hidden != nil) {
    // The window shows once iPadOS connects its scene again, as one it disconnected does.
    [self show:nil scene:nil session:hidden own:YES key:key title:title resolve:resolve];
    return;
  }
  NSString *requestId = NSUUID.UUID.UUIDString;
  __weak NgNativeWindowHost *weakSelf = self;
  _requests[requestId] = ^(UIWindowScene *scene) {
    NgNativeWindowHost *host = weakSelf;
    if (host == nil || scene == nil) {
      resolve(nil);
      return;
    }
    UIWindow *window = [[UIWindow alloc] initWithWindowScene:scene];
    [host show:window scene:scene session:scene.session own:YES key:key title:title resolve:resolve];
  };
  NSUserActivity *activity = [[NSUserActivity alloc] initWithActivityType:WindowActivity];
  activity.userInfo = @{@"request" : requestId, @"key" : key ?: @""};
  // Options from iOS 17, as focus: passes them; nil below, where the system picks the scene.
  UISceneActivationRequestOptions *options = nil;
  if (@available(iOS 17.0, *)) {
    options = [UISceneActivationRequestOptions new];
    options.requestingScene = [self activeScene];
  }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  [UIApplication.sharedApplication requestSceneSessionActivation:nil
                                                    userActivity:activity
                                                         options:options
                                                    errorHandler:^(NSError *error) {
                                                      dispatch_async(dispatch_get_main_queue(), ^{
                                                        NgNativeWindowHost *host = weakSelf;
                                                        if (host == nil) {
                                                          return;
                                                        }
                                                        void (^waitingOn)(UIWindowScene *) = host->_requests[requestId];
                                                        [host->_requests removeObjectForKey:requestId];
                                                        if (waitingOn) {
                                                          waitingOn(nil);
                                                        }
                                                      });
                                                    }];
#pragma clang diagnostic pop
}

/** The scene the app launched in, the app's own, while it is connected. */
- (nullable UIWindowScene *)launchScene
{
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if ([scene isKindOfClass:[UIWindowScene class]] && isAppScene(scene) && [self windowForScene:scene] == nil) {
      return (UIWindowScene *)scene;
    }
  }
  return nil;
}

- (nullable UIWindowScene *)activeScene
{
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (scene.activationState == UISceneActivationStateForegroundActive && [scene isKindOfClass:[UIWindowScene class]]) {
      return (UIWindowScene *)scene;
    }
  }
  return nil;
}

/** A session iPadOS keeps for the window with `key` with no scene connected: a hidden window. */
- (nullable UISceneSession *)hiddenSessionFor:(nullable NSString *)key
{
  NSMutableArray<UISceneSession *> *sessions = [NSMutableArray array];
  NSMutableArray<NSString *> *ids = [NSMutableArray array];
  for (UISceneSession *session in UIApplication.sharedApplication.openSessions) {
    if (session.scene == nil && [self windowForSession:session] == nil) {
      [sessions addObject:session];
      [ids addObject:session.persistentIdentifier];
    }
  }
  NSUInteger found = NgNativeSessionForKey(self.kept, ids, key);
  return found == NSNotFound ? nil : sessions[found];
}

/**
 Once the claim time is up, a scene the app launched in that no window took shows a window that is
 waiting for its hidden scene instead; with none waiting, the scene goes.
 */
- (void)dropLaunchSceneUnlessTaken:(UIWindowScene *)launch
{
  __weak UIWindowScene *weakLaunch = launch;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(ClaimSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    UIWindowScene *scene = weakLaunch;
    if (scene == nil || self->_launchTaken || [self launchScene] != scene) {
      return;
    }
    for (NgNativeSceneWindow *window in self->_windows.allValues) {
      if (window.scene == nil) {
        UISceneSession *hidden = window.session;
        self->_launchTaken = YES;
        window.own = NO;
        window.session = scene.session;
        [self keep:scene.session key:window.key];
        [self reattach:window to:scene];
        [self destroySession:hidden];
        return;
      }
    }
    [self destroyScene:scene];
  });
}

/**
 A surface of its own in `window`, resolved with its id once it runs. With no window, the surface
 waits for its session's scene to connect.
 */
- (void)show:(nullable UIWindow *)window
       scene:(nullable UIWindowScene *)scene
     session:(UISceneSession *)session
         own:(BOOL)own
         key:(nullable NSString *)key
       title:(NSString *)title
     resolve:(void (^)(id _Nullable surface))resolve
{
  id<RCTSurfaceProtocol> surface = [reactHost createSurfaceWithModuleName:WindowRunnable initialProperties:@{}];
  if (surface == nil) {
    resolve(nil);
    return;
  }
  NgNativeWindowRootView *rootView = [[NgNativeWindowRootView alloc] initWithSurface:surface];
  rootView.backgroundColor = UIColor.systemBackgroundColor;
  NgNativeSceneWindow *record = [NgNativeSceneWindow new];
  record.surface = surface.rootViewTag.integerValue;
  record.scene = scene;
  record.session = session;
  record.own = own;
  record.window = own ? window : nil;
  record.rootView = rootView;
  record.key = key;
  record.title = title;
  _windows[@(record.surface)] = record;
  // A scene iPadOS restores with the session goes back to the same window.
  [self keep:session key:key];
  scene.title = title;
  __weak NgNativeWindowHost *weakSelf = self;
  NSInteger surfaceId = record.surface;
  rootView.onResize = ^(CGSize size, CGFloat scale) {
    [weakSelf send:@{
      @"type" : @"resize",
      @"surface" : @(surfaceId),
      @"width" : @(size.width),
      @"height" : @(size.height),
      @"scale" : @(scale),
    }];
  };
  rootView.onRunning = ^{
    resolve(@(surfaceId));
    if (scene != nil && scene.activationState == UISceneActivationStateForegroundActive) {
      [weakSelf send:@{@"type" : @"focus", @"surface" : @(surfaceId)}];
    }
  };
  if (window != nil) {
    [self put:rootView in:window];
    return;
  }
  // Laid out the size of a window the app has, until its own scene connects, rather than at none.
  UIWindowScene *sized = [self activeScene] ?: [self anyWindowScene];
  if (sized != nil) {
    rootView.frame = sized.coordinateSpace.bounds;
    [rootView layoutIfNeeded];
  }
}

- (nullable UIWindowScene *)anyWindowScene
{
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if ([scene isKindOfClass:[UIWindowScene class]]) {
      return (UIWindowScene *)scene;
    }
  }
  return nil;
}

- (void)put:(NgNativeWindowRootView *)rootView in:(UIWindow *)window
{
  UIViewController *controller = [UIViewController new];
  controller.view = rootView;
  window.rootViewController = controller;
  [window makeKeyAndVisible];
}

#pragma mark Scenes iPadOS connects

- (void)connected:(UIWindowScene *)scene options:(UISceneConnectionOptions *)options
{
  BOOL marked = NgNativeSessionHadWindow(self.kept, scene.session.persistentIdentifier);
  [self keep:scene.session key:[self keyOf:scene.session]];
  // A window whose scene iPadOS disconnected in the background: it shows again as it was.
  NgNativeSceneWindow *detached = [self windowForSession:scene.session];
  if (detached != nil) {
    [self reattach:detached to:scene];
    return;
  }
  for (NSUserActivity *activity in options.userActivities) {
    NSString *requestId = activity.userInfo[@"request"];
    if (![requestId isKindOfClass:[NSString class]]) {
      continue;
    }
    void (^waitingOn)(UIWindowScene *) = _requests[requestId];
    if (waitingOn) {
      [_requests removeObjectForKey:requestId];
      waitingOn(scene);
      return;
    }
  }
  // A scene the user made, or one of a window's: it waits for the app to open a window in it.
  NgNativeWaitingScene *waiting = [NgNativeWaitingScene new];
  waiting.scene = scene;
  waiting.userMade = !marked && !isWindowActivity(options.userActivities);
  waiting.window = [[UIWindow alloc] initWithWindowScene:scene];
  UIViewController *blank = [UIViewController new];
  blank.view.backgroundColor = UIColor.systemBackgroundColor;
  waiting.window.rootViewController = blank;
  [waiting.window makeKeyAndVisible];
  [_waiting addObject:waiting];
  [self send:@{@"type" : waiting.userMade ? @"newWindow" : @"reopen"}];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(ClaimSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    if ([self->_waiting containsObject:waiting]) {
      [self->_waiting removeObject:waiting];
      [self destroyScene:waiting.scene];
    }
  });
}

- (void)sceneActivated:(NSNotification *)note
{
  NgNativeSceneWindow *window = [self windowForScene:note.object];
  if (window != nil) {
    [self send:@{@"type" : @"focus", @"surface" : @(window.surface)}];
  }
}

- (void)sceneDeactivating:(NSNotification *)note
{
  if ([self windowForScene:note.object] != nil) {
    [self send:@{@"type" : @"focus", @"surface" : NSNull.null}];
  }
}

/**
 iPadOS disconnects a scene the user closed, and one in the background whose memory it takes back,
 whose session it keeps: the window keeps its surface until the session is discarded.
 */
- (void)sceneDisconnected:(NSNotification *)note
{
  NgNativeSceneWindow *window = [self windowForScene:note.object];
  if (window == nil) {
    return;
  }
  window.window.hidden = YES;
  window.window = nil;
}

- (void)reattach:(NgNativeSceneWindow *)record to:(UIWindowScene *)scene
{
  record.scene = scene;
  scene.title = record.title;
  if (record.own) {
    record.window = [[UIWindow alloc] initWithWindowScene:scene];
    [self put:record.rootView in:record.window];
  } else {
    UIWindow *window = scene.keyWindow ?: scene.windows.firstObject;
    if (window == nil) {
      // A scene this file's delegate hosted for the app, connected again after the app launched:
      // nothing made it a window, so the record makes one and hides it as it closes.
      window = [[UIWindow alloc] initWithWindowScene:scene];
      record.window = window;
    }
    _launchRoot = window.rootViewController;
    [self put:record.rootView in:window];
  }
}

/** The sessions of the scenes the user closed. */
- (void)discarded:(NSSet<UISceneSession *> *)sessions
{
  [self forgetClosedSessions:sessions];
  for (UISceneSession *session in sessions) {
    NgNativeSceneWindow *window = [self windowForSession:session];
    if (window != nil) {
      [self send:@{@"type" : @"closed", @"surface" : @(window.surface)}];
      [self closeWindow:window destroy:NO];
    }
  }
}

#pragma mark Closing

- (void)close:(NSInteger)surface
{
  NgNativeSceneWindow *window = _windows[@(surface)];
  if (window != nil) {
    [self closeWindow:window destroy:YES];
  }
}

- (void)closeWindow:(NgNativeSceneWindow *)window destroy:(BOOL)destroy
{
  [_windows removeObjectForKey:@(window.surface)];
  [window.rootView.surface stop];
  UIWindowScene *scene = window.scene;
  if (!window.own) {
    // The scene the app launched in shows what it showed before, should it come back.
    if (scene != nil && _launchRoot != nil) {
      (scene.keyWindow ?: scene.windows.firstObject).rootViewController = _launchRoot;
    }
    _launchTaken = NO;
  }
  window.window.hidden = YES;
  if (destroy) {
    [self destroySession:window.session];
  }
}

- (void)destroyScene:(nullable UIWindowScene *)scene
{
  [self destroySession:scene.session];
}

- (void)destroySession:(nullable UISceneSession *)session
{
  if (session == nil) {
    return;
  }
  // iPadOS destroys no session whose scene has not connected since the app launched: that one is
  // kept for no window, so once it connects it waits for one as a restored scene does, and goes.
  __weak NgNativeWindowHost *weakSelf = self;
  [UIApplication.sharedApplication requestSceneSessionDestruction:session
                                                          options:nil
                                                     errorHandler:^(NSError *error) {
                                                       dispatch_async(dispatch_get_main_queue(), ^{
                                                         [weakSelf keep:session key:nil];
                                                       });
                                                     }];
}

/** The app answered a window the user made with one it has open: the scenes the user made go. */
- (void)dropUserMadeScenes
{
  for (NgNativeWaitingScene *waiting in [_waiting copy]) {
    if (waiting.userMade) {
      [_waiting removeObject:waiting];
      [self destroyScene:waiting.scene];
    }
  }
}

- (void)focus:(NSInteger)surface
{
  UISceneSession *session = _windows[@(surface)].session;
  if (session == nil) {
    return;
  }
  [self dropUserMadeScenes];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  [UIApplication.sharedApplication requestSceneSessionActivation:session
                                                    userActivity:nil
                                                         options:nil
                                                    errorHandler:nil];
#pragma clang diagnostic pop
}

- (void)setTitle:(NSString *)title of:(NSInteger)surface
{
  NgNativeSceneWindow *window = _windows[@(surface)];
  window.title = title;
  window.scene.title = title;
}

@end

#pragma mark - The scene delegate

/** The scene delegate the app's Info.plist names, which starts React Native in its scene. */
static Class appSceneDelegateClass(void)
{
  NSDictionary *manifest = NSBundle.mainBundle.infoDictionary[@"UIApplicationSceneManifest"];
  NSArray *configurations = manifest[@"UISceneConfigurations"][@"UIWindowSceneSessionRoleApplication"];
  NSString *name = [configurations.firstObject isKindOfClass:[NSDictionary class]]
      ? configurations.firstObject[@"UISceneDelegateClassName"]
      : nil;
  if (![name isKindOfClass:[NSString class]]) {
    return Nil;
  }
  // A Swift class is found by its module-qualified name, or by its plain one where it names itself
  // for Objective-C, as Expo's does.
  return NSClassFromString(name) ?: NSClassFromString([name componentsSeparatedByString:@"."].lastObject);
}

@implementation NgNativeWindowSceneDelegate {
  // The app's own delegate, for a window's scene iPadOS restored before the app had launched: that
  // scene is the app's now, and everything it is told goes to that delegate.
  id<UIWindowSceneDelegate> _app;
}

- (BOOL)hostsApp
{
  return _app != nil;
}

- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)connectionOptions
{
  if (reactHost == nil) {
    Class appDelegate = appSceneDelegateClass();
    if (appDelegate != Nil && appDelegate != [self class]) {
      _app = [appDelegate new];
      [_app scene:scene willConnectToSession:session options:connectionOptions];
      return;
    }
  }
  if ([scene isKindOfClass:[UIWindowScene class]]) {
    [[NgNativeWindowHost shared] connected:(UIWindowScene *)scene options:connectionOptions];
  }
  // A link that opened this scene, or an activity handed to it, as the app's own scene hands on.
  if (connectionOptions.URLContexts.count > 0) {
    [self scene:scene openURLContexts:connectionOptions.URLContexts];
  }
  for (NSUserActivity *activity in connectionOptions.userActivities) {
    if (![activity.activityType isEqualToString:WindowActivity]) {
      [self scene:scene continueUserActivity:activity];
    }
  }
}

// UIKit reads which methods a scene delegate has as it is set, before `_app` is made, so each one
// the app's delegate may answer is here, handing on what it is told.
- (UIWindow *)window
{
  return [_app respondsToSelector:@selector(window)] ? _app.window : nil;
}

- (void)sceneDidDisconnect:(UIScene *)scene
{
  if ([_app respondsToSelector:_cmd]) {
    [_app sceneDidDisconnect:scene];
  }
}

- (void)sceneDidBecomeActive:(UIScene *)scene
{
  if ([_app respondsToSelector:_cmd]) {
    [_app sceneDidBecomeActive:scene];
  }
}

- (void)sceneWillResignActive:(UIScene *)scene
{
  if ([_app respondsToSelector:_cmd]) {
    [_app sceneWillResignActive:scene];
  }
}

- (void)sceneWillEnterForeground:(UIScene *)scene
{
  if ([_app respondsToSelector:_cmd]) {
    [_app sceneWillEnterForeground:scene];
  }
}

- (void)sceneDidEnterBackground:(UIScene *)scene
{
  if ([_app respondsToSelector:_cmd]) {
    [_app sceneDidEnterBackground:scene];
  }
}

// A link or a handed-off activity for a window's scene goes to the app delegate, as the app's own
// scene delegate hands on its own: Expo's modules subscribe to the app delegate's.
- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts
{
  if (_app != nil) {
    if ([_app respondsToSelector:_cmd]) {
      [_app scene:scene openURLContexts:URLContexts];
    }
    return;
  }
  UIApplication *app = UIApplication.sharedApplication;
  id<UIApplicationDelegate> delegate = app.delegate;
  if (![delegate respondsToSelector:@selector(application:openURL:options:)]) {
    return;
  }
  for (UIOpenURLContext *context in URLContexts) {
    NSMutableDictionary<UIApplicationOpenURLOptionsKey, id> *options = [NSMutableDictionary dictionary];
    options[UIApplicationOpenURLOptionsOpenInPlaceKey] = @(context.options.openInPlace);
    options[UIApplicationOpenURLOptionsSourceApplicationKey] = context.options.sourceApplication;
    options[UIApplicationOpenURLOptionsAnnotationKey] = context.options.annotation;
    [delegate application:app openURL:context.URL options:options];
  }
}

- (void)scene:(UIScene *)scene continueUserActivity:(NSUserActivity *)userActivity
{
  if (_app != nil) {
    if ([_app respondsToSelector:_cmd]) {
      [_app scene:scene continueUserActivity:userActivity];
    }
    return;
  }
  UIApplication *app = UIApplication.sharedApplication;
  id<UIApplicationDelegate> delegate = app.delegate;
  if ([delegate respondsToSelector:@selector(application:continueUserActivity:restorationHandler:)]) {
    [delegate application:app
        continueUserActivity:userActivity
          restorationHandler:^(NSArray<id<UIUserActivityRestoring>> *restorable){
          }];
  }
}

@end

#pragma mark - The module

@implementation NgNativeWindows

@synthesize callableJSModules = _callableJSModules;

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (instancetype)init
{
  if (self = [super init]) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (multipleWindows()) {
        [[NgNativeWindowHost shared] attach:self];
      }
    });
  }
  return self;
}

- (NSDictionary *)constantsToExport
{
  return @{@"multipleWindows" : @(multipleWindows())};
}

- (void)invalidate
{
}

- (void)send:(NSDictionary *)event
{
  [_callableJSModules invokeModule:@"RCTDeviceEventEmitter" method:@"emit" withArgs:@[ @"ngNativeWindows", event ]];
}

RCT_EXPORT_METHOD(open : (NSDictionary *)request resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  [[NgNativeWindowHost shared] open:request resolve:^(id surface) {
    resolve(surface ?: NSNull.null);
  }];
}

RCT_EXPORT_METHOD(close : (double)surface)
{
  [[NgNativeWindowHost shared] close:(NSInteger)surface];
}

RCT_EXPORT_METHOD(focus : (double)surface)
{
  [[NgNativeWindowHost shared] focus:(NSInteger)surface];
}

RCT_EXPORT_METHOD(setTitle : (double)surface title : (NSString *)title)
{
  [[NgNativeWindowHost shared] setTitle:title of:(NSInteger)surface];
}

// iOS ends an app itself: there is nothing to quit, and no quit to answer.
RCT_EXPORT_METHOD(quit)
{
}

RCT_EXPORT_METHOD(answerQuit : (BOOL)proceed)
{
}

@end
