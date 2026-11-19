// ngn-macos: the macOS desktop host. Loads a bundle into one runtime, starts the app on a surface
// that is never shown, and gives each window the app opens (NgNativeWindows) a surface of its own.
//
//   ngn-macos <bundle> [--module <name>] [--title <title>] [--app-id <id>] [--capabilities <json>]
//   ngn-macos              (a packaged app: what its Info.plist names; argv and env are ignored)
//
// <bundle> is a JavaScript or Hermes bytecode file on disk, or a Metro bundle URL, which turns on
// the dev loop: reload and Fast Refresh from the dev server, and the Developer menu. The module
// defaults to "main", the name an ng-native app registers. The app id names the app's data and
// preferences until it is packaged with a bundle identifier (default: the title).
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

#import "animation-frames.h"
#import "input-replay.h"
#include "ngn/host-views.h"
#include "ngn/worklet-host.h"
#import "notifications.h"
#import "undo.h"
#import "app-windows.h"
#import "appkit-backend.h"
#import "header-toolbar.h"
#import "menu-bar.h"
#import "modal-host-view.h"
#import "network.h"
#import "red-box.h"
#import "scroll-view.h"
#import "split-view.h"
#import "system.h"
#import "system-access.h"
#import "desktop-expo.h"
#import "local-authentication.h"
#import "location.h"
#import "crypto.h"
#import "app-info.h"
#import "network-state.h"
#import "battery.h"
#import "fonts.h"
#import "web-browser.h"
#import "text-recognition.h"
#import "calendar.h"
#import "audio.h"
#import "video.h"
#import "language-model.h"
#import "screen-capture.h"
#import "photo-library.h"
#import "tracking.h"
#import "image-manipulator.h"
#import "printing.h"
#import "expo-image-view.h"
#import "camera-sheet.h"
#import "camera-view.h"
#import "camera.h"
#import "map-view.h"
#import "apple-authentication.h"
#include "ngn/web-view.h"
#import "geocoder.h"
#import "address-search.h"
#include "ngn/asset.h"
#import "symbol-drawing.h"
#import "share-picker.h"
#include "ngn/splash-screen.h"
#include "ngn/launch-frame.h"
#import "store-review.h"
#import "bookmarks.h"
#import "push.h"
#import "file-system.h"
#import "tray-and-dock.h"
#import "test-launch.h"
#import "updates.h"
#import "surface-view.h"
#import "tab-walk.h"
#include "text-layout.h"

#include "ngn/app-menus.h"
#include "ngn/back-swipe.h"
#include "ngn/core-modules.h"
#include "ngn/desktop-modules.h"
#include "ngn/default-menu.h"
#include "ngn/desktop-modal.h"
#include "ngn/input-dispatcher.h"
#import "native-controls.h"
#include "ngn/focus-order.h"
#include "ngn/layout-animations.h"
#include "ngn/launch-settings.h"
#include "ngn/runtime.h"
#include "ngn/sqlite.h"

#include <sys/sysctl.h>
#include <unistd.h>

#include <mutex>
#include <unordered_map>
#include <string>

using namespace facebook::react;

namespace {

// The surface the app starts on, which the host never shows: the app renders each window on a
// surface of its own (app-windows.h).
constexpr SurfaceId kAppSurface = 1;

struct Host {
  std::shared_ptr<ngn::appkit::AppKitBackend> backend;
  std::shared_ptr<ngn::MountingManager> mounting;
  std::unique_ptr<ngn::InputDispatcher> input;
  std::shared_ptr<ngn::HostState> state;
  std::unique_ptr<ngn::Runtime> runtime;
  std::shared_ptr<ngn::appkit::AppKitWindows> windows;
  std::shared_ptr<ngn::WindowHost> windowHost;
  std::shared_ptr<ngn::MenuHost> menus;
  std::shared_ptr<ngn::TrayHost> tray;
  std::shared_ptr<ngn::DockHost> dockHost;
  std::shared_ptr<ngn::appkit::AppKitDock> dock;
  NGNSurfaceView *appSurface;
  // The app's own surface in a window, for an app that renders there instead of opening windows.
  NSWindow *appWindow;
  NSString *title;
  std::shared_ptr<ngn::ProcessLauncher> launcher;
  // Ticks the layout animations while they run, at the display's rate.
  NSTimer *animationTimer;
  bool firstFrameLogged = false;
  // What the host runs and how (launch-settings.h), set once at launch.
  const ngn::LaunchSettings *launch = nullptr;
  // The app window is ordered front once, when its safe areas settle (showAppWindowWhenSettled).
  bool appWindowShown = false;
  // The launch running, the first or a reload's, has yet to put content its own JavaScript
  // instance mounted in a window on screen, which starts its success timer (launch-frame.h).
  ngn::LaunchFrame launchFrame;
  // The Expo Updates client, for a bundle on disk (updates.h).
  std::shared_ptr<ngn::UpdatesClient> updates;
  // Remote notifications: the device token's registration, and where a silent one is heard.
  std::shared_ptr<ngn::PushTokens> push;
  std::shared_ptr<ngn::NotificationEvents> notificationEvents;
  // A dev run's red box (red-box.h).
  std::shared_ptr<ngn::RedBox> redBox;
};

Host gHost;

// The bundle the runtime runs now, for SourceCode's scriptURL: set at launch and before a reload
// into an update, read on the JavaScript thread.
std::mutex gBundleMutex;
std::string gBundle;

void setRunningBundle(const std::string &bundle) {
  std::lock_guard lock(gBundleMutex);
  gBundle = bundle;
}

ngn::WindowMetrics windowMetrics(NSWindow *window) {
  NSSize size = window.contentView.bounds.size;
  NSSize screen = (window.screen != nil ? window.screen : NSScreen.mainScreen).frame.size;
  double scale = window.backingScaleFactor;
  return {
      .window = {.width = size.width, .height = size.height, .scale = scale, .fontScale = 1},
      .screen = {.width = screen.width, .height = screen.height, .scale = scale, .fontScale = 1},
  };
}

ngn::SurfaceMetrics metricsFor(NSSize size, double scale) {
  return {
      .size = {static_cast<Float>(size.width), static_cast<Float>(size.height)},
      .pointScale = static_cast<float>(scale),
      .fontScale = 1,
  };
}

ngn::SurfaceMetrics metricsFor(NSWindow *window) {
  return metricsFor(window.contentView.bounds.size, window.backingScaleFactor);
}

// Milliseconds since the process started, dyld and all, from the kernel's start time.
double msSinceLaunch() {
  struct kinfo_proc info {};
  size_t size = sizeof(info);
  int mib[] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()};
  if (sysctl(mib, 4, &info, &size, nullptr, 0) != 0) {
    return -1;
  }
  struct timeval now {};
  gettimeofday(&now, nullptr);
  const auto &start = info.kp_proc.p_starttime;
  return (now.tv_sec - start.tv_sec) * 1000.0 + (now.tv_usec - start.tv_usec) / 1000.0;
}

void logFirstFrame(NSWindow *window) {
  if (gHost.firstFrameLogged || window == nil || !window.visible) {
    return;
  }
  gHost.firstFrameLogged = true;
  // Draw now rather than at the end of this run loop pass, so the time covers the first frame.
  [window displayIfNeeded];
  [CATransaction flush];
  fprintf(stderr, "[ngn] first frame %.0f ms after launch\n", msSinceLaunch());
  // A dev run's input script (input-script.h), played into the first window once it shows.
  if (const auto &path = gHost.launch->inputScript; !path.empty() && gHost.runtime && gHost.runtime->devServer()) {
    NSString *text = [NSString stringWithContentsOfFile:@(path.c_str()) encoding:NSUTF8StringEncoding error:nil];
    auto script = ngn::parseInputScript(text ? std::string(text.UTF8String) : std::string());
    if (!text || script.error) {
      fprintf(stderr, "[ngn] input script %s: %s\n", path.c_str(), text ? script.error->c_str() : "cannot be read");
    } else {
      ngn::appkit::replayInputScript(window, std::move(script));
    }
  }
  if (gHost.launch->logRotors) {
    // A second after the first frame, when the app has settled.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      if (auto *surface = (NGNSurfaceView *)window.contentView; [surface isKindOfClass:NGNSurfaceView.class]) {
        fprintf(stderr, "[ngn] rotors\n%s\n", surface.rotorItemsDescription.UTF8String);
      }
    });
  }
}

// Tab and Shift-Tab (tab-walk.h). True when the key is used.
bool moveFocus(NSEvent *event) {
  // Option-Tab reaches every focusable view, whatever the keyboard navigation setting.
  bool everything = NSApp.isFullKeyboardAccessEnabled || (event.modifierFlags & NSEventModifierFlagOption) != 0;
  auto reach = everything ? ngn::TabReach::All : ngn::TabReach::TextInputs;
  bool backwards = (event.modifierFlags & NSEventModifierFlagShift) != 0;
  return ngn::appkit::moveFocus(event.window, gHost.mounting->tree(), *gHost.backend, backwards, reach);
}

// Arrow keys, Home and End inside a composite widget (a tablist, radiogroup, menu, menubar, listbox
// or grid), walked in the core (focus-order.h compositeMove). True when the key is used.
bool moveInComposite(NSEvent *event) {
  static const std::unordered_map<unsigned short, ngn::CompositeKey> keys{
      {123, ngn::CompositeKey::Left}, {124, ngn::CompositeKey::Right}, {125, ngn::CompositeKey::Down},
      {126, ngn::CompositeKey::Up},   {115, ngn::CompositeKey::Home},  {119, ngn::CompositeKey::End},
  };
  auto key = keys.find(event.keyCode);
  auto mods = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagShift);
  if (key == keys.end() || mods != 0) {
    return false;
  }
  NSWindow *window = event.window;
  auto [container, focused] = ngn::appkit::focusContext(window);
  if (container == nil || focused == nil || window.firstResponder != focused) {
    return false;
  }
  bool control = (event.modifierFlags & NSEventModifierFlagControl) != 0;
  auto next = ngn::compositeMove(
      gHost.mounting->tree(), container.rootTag, static_cast<Tag>(focused.reactTag), key->second, control);
  if (!next) {
    return false;
  }
  if (NGNView *view = gHost.backend->view(*next); view != nil && view != focused) {
    [window makeFirstResponder:view.keyboardResponder];
  }
  return true;
}

// The surface of the window `window` is, or belongs to (a sheet's or a popover's parent), if any.
std::optional<SurfaceId> surfaceOf(NSWindow *window) {
  for (NSWindow *w = window; w != nil; w = w.sheetParent != nil ? w.sheetParent : w.parentWindow) {
    if (auto surface = gHost.windows->surfaceOf(w)) {
      return surface;
    }
  }
  return std::nullopt;
}

void reloadLaunched(uint64_t generation, uint64_t instance);
void reloadSameLaunch();

// The menu bar the core asks for, drawn on the main thread.
struct AppKitMenus final : ngn::MenuBackend {
  void setMenuBar(std::vector<ngn::MenuItem> bar) override {
    auto shared = std::make_shared<std::vector<ngn::MenuItem>>(std::move(bar));
    dispatch_async(dispatch_get_main_queue(), ^{
      ngn::appkit::installMenuBar(*shared, [](const ngn::MenuItem &item) {
        if (item.command == ngn::MenuCommand::Reload && gHost.runtime) {
          reloadSameLaunch();
        } else if (item.command == ngn::MenuCommand::OpenDevTools && gHost.runtime) {
          gHost.runtime->openDebugger();
        } else if (gHost.menus) {
          gHost.menus->choose(item, surfaceOf(NSApp.keyWindow));
        }
      });
    });
  }
};

// A key press as the web names it, with the modifiers held.
ngn::KeyChord chordOf(NSEvent *event) {
  static NSDictionary<NSNumber *, NSString *> *named = @{
    @123 : @"ArrowLeft", @124 : @"ArrowRight", @125 : @"ArrowDown", @126 : @"ArrowUp",
    @36 : @"Enter", @76 : @"Enter", @53 : @"Escape", @51 : @"Backspace", @117 : @"Delete",
    @48 : @"Tab", @115 : @"Home", @119 : @"End", @116 : @"PageUp", @121 : @"PageDown",
    @122 : @"F1", @120 : @"F2", @99 : @"F3", @118 : @"F4", @96 : @"F5", @97 : @"F6",
    @98 : @"F7", @100 : @"F8", @101 : @"F9", @109 : @"F10", @103 : @"F11", @111 : @"F12",
  };
  NSString *key = named[@(event.keyCode)];
  if (key == nil) {
    // Shift still applies, as the web's `key` has it: shift+/ is "?".
    key = event.charactersIgnoringModifiers != nil ? event.charactersIgnoringModifiers : @"";
  }
  unsigned modifiers = 0;
  NSEventModifierFlags flags = event.modifierFlags;
  if (flags & NSEventModifierFlagCommand) modifiers |= ngn::Command;
  if (flags & NSEventModifierFlagShift) modifiers |= ngn::Shift;
  if (flags & NSEventModifierFlagOption) modifiers |= ngn::Option;
  if (flags & NSEventModifierFlagControl) modifiers |= ngn::Control;
  return {.key = std::string(key.UTF8String), .modifiers = modifiers};
}

bool textInputFocused(NSWindow *window) {
  return [window.firstResponder isKindOfClass:NSText.class];
}

// Whether a horizontal scroll at the event belongs to a scroll view that scrolls sideways.
bool scrollsSideways(NSEvent *event, NSWindow *window) {
  // A replayed scroll the window takes itself has no window, and its location is on the screen.
  NSPoint point = event.window == window ? event.locationInWindow : [window convertPointFromScreen:event.locationInWindow];
  NSView *hit = [window.contentView hitTest:[window.contentView.superview convertPoint:point fromView:nil]];
  for (NSView *v = hit; v != nil; v = v.superview) {
    if ([v isKindOfClass:NSScrollView.class]) {
      NSScrollView *scroll = (NSScrollView *)v;
      if (NSWidth(scroll.documentView.frame) > NSWidth(scroll.contentView.bounds) + 1) {
        return true;
      }
    }
  }
  return false;
}

void navigate(ngn::NavigationDirection direction, NSWindow *window) {
  if (gHost.menus) {
    gHost.menus->navigate(direction, surfaceOf(window));
  }
}

// The interactive back swipe (back-swipe.h) in flight, and the screens it moves.
struct Swipe {
  ngn::BackSwipe swipe;
  NGNView *top;
  NGNView *below;
  NSWindow *window;
  SurfaceId surface = 0;
  // The direction the swipe began in, which its later moves keep though a reload changes the app's.
  bool rightToLeft = false;
  // The momentum scrolls after a swipe's fingers lift are the swipe's, not the content's.
  bool swallowMomentum = false;
  // Bumped as a swipe starts or ends, so a late animation step or timeout of an old one stops.
  int generation = 0;
  NSTimer *animation;
};
Swipe gSwipe;

void drawSwipe(const ngn::BackSwipeFrame &frame) {
  gSwipe.top.swipeOffset = frame.offset;
  gSwipe.top.swipeOpacity = frame.opacity;
  gSwipe.below.swipeShown = frame.belowShown;
}

// The swipe is over: every screen as layout and the stack put it.
void endSwipe() {
  [gSwipe.animation invalidate];
  gSwipe.animation = nil;
  drawSwipe(ngn::BackSwipe::rest());
  gSwipe.top = nil;
  gSwipe.below = nil;
  gSwipe.window = nil;
  gSwipe.surface = 0;
  gSwipe.generation++;
}

// A window closed: a swipe in it ends, whatever its phase, or it would hold every later swipe.
void swipeWindowClosed(SurfaceId surface) {
  if (gSwipe.window != nil && gSwipe.surface == surface) {
    gSwipe.swipe.abandon();
    endSwipe();
  }
}

// Eases the moving screen from where it is to `to` over a fifth of a second, then calls `done`.
void animateSwipe(ngn::BackSwipeFrame to, void (^done)(void)) {
  [gSwipe.animation invalidate];
  ngn::BackSwipeFrame from{
      .offset = gSwipe.top.swipeOffset, .opacity = gSwipe.top.swipeOpacity, .belowShown = gSwipe.below.swipeShown == YES};
  CFTimeInterval start = CACurrentMediaTime();
  constexpr CFTimeInterval kDuration = 0.2;
  gSwipe.animation = [NSTimer scheduledTimerWithTimeInterval:1.0 / 120 repeats:YES block:^(NSTimer *timer) {
    double t = std::min(1.0, (CACurrentMediaTime() - start) / kDuration);
    double eased = 1 - (1 - t) * (1 - t) * (1 - t);
    drawSwipe({.offset = from.offset + (to.offset - from.offset) * eased,
               .opacity = from.opacity + (to.opacity - from.opacity) * eased,
               .belowShown = to.belowShown || from.belowShown});
    if (t >= 1) {
      [timer invalidate];
      gSwipe.animation = nil;
      if (done != nil) {
        done();
      }
    }
  }];
}

// How far the fingers moved right: AppKit's delta moves the content, which follows the fingers
// only with natural scrolling.
double fingersMovedRight(NSEvent *event) {
  return event.isDirectionInvertedFromDevice ? event.scrollingDeltaX : -event.scrollingDeltaX;
}

// Whether the app lays out right to left, which turns the swipes round: left goes back.
bool swipesRightToLeft() {
  return gHost.runtime && gHost.runtime->laysOutRightToLeft();
}

// The fingers lifted from a tracking swipe: it goes back, or slides home.
void liftSwipe(NSEvent *event) {
  bool back = gSwipe.swipe.lifted(event.phase == NSEventPhaseCancelled);
  if (!back) {
    animateSwipe(gSwipe.swipe.settled(), ^{
      gSwipe.swipe.returned();
      endSwipe();
    });
    return;
  }
  animateSwipe(gSwipe.swipe.settled(), nil);
  auto surface = surfaceOf(gSwipe.window);
  if (surface && gHost.menus->history(*surface)) {
    gHost.menus->navigate(ngn::NavigationDirection::Back, surface);
  } else if (auto emitter = gSwipe.top.eventEmitter) {
    // An app that reports no history: the stack's own back, as the back chevron sends it.
    emitter->dispatchEvent("headerBackButtonClicked");
  }
  // A back the app refused (a guard) never pops: the screen comes home.
  int generation = gSwipe.generation;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    if (gSwipe.generation == generation && gSwipe.swipe.phase() == ngn::BackSwipe::Phase::Leaving) {
      gSwipe.swipe.abandon();
      animateSwipe(ngn::BackSwipe::rest(), ^{
        endSwipe();
      });
    }
  });
}

// A leaving swipe ends once its stack's top screen has changed.
void swipeMounted() {
  const auto &target = gSwipe.swipe.target();
  if (target && gSwipe.swipe.mounted(gHost.mounting->stackTop(target->stack))) {
    endSwipe();
  }
}

// "Swipe between pages" with two fingers: a sideways scroll that nothing scrolls sideways. A back
// swipe over a stack with a screen below drags the screen in front; any other goes when it ends.
// Answers the event to send on, or nil where the swipe took it.
NSEvent *swipeScroll(NSEvent *event, NSWindow *window) {
  if (event.phase == NSEventPhaseBegan && gSwipe.swipe.fingersDown()) {
    endSwipe();
  }
  if (gSwipe.swipe.phase() == ngn::BackSwipe::Phase::Tracking) {
    if (window != gSwipe.window) {
      return event;
    }
    double dx = ngn::towardsBack(fingersMovedRight(event), gSwipe.rightToLeft);
    if (dx != 0) {
      drawSwipe(gSwipe.swipe.moved(dx));
    }
    if (event.phase == NSEventPhaseEnded || event.phase == NSEventPhaseCancelled) {
      liftSwipe(event);
    }
    return nil;
  }
  if (event.momentumPhase != NSEventPhaseNone && gSwipe.swallowMomentum) {
    return nil;
  }
  if (!NSEvent.isSwipeTrackingFromScrollEventsEnabled || event.phase != NSEventPhaseBegan) {
    return event;
  }
  gSwipe.swallowMomentum = false;
  auto surface = surfaceOf(window);
  if (fabs(event.scrollingDeltaX) <= fabs(event.scrollingDeltaY) || !surface || scrollsSideways(event, window)) {
    return event;
  }
  // Without a history from the app, the stack in front decides.
  auto history = gHost.menus->history(*surface);
  bool canGoBack = !history || !history->back.empty();
  bool canGoForward = !history || !history->forward.empty();
  bool rightToLeft = swipesRightToLeft();
  double dx = ngn::towardsBack(fingersMovedRight(event), rightToLeft);
  if (dx > 0 && canGoBack && gSwipe.swipe.phase() == ngn::BackSwipe::Phase::Idle) {
    auto target = gHost.mounting->backSwipeTarget(*surface);
    NGNView *top = target ? gHost.backend->view(target->top) : nil;
    NGNView *below = target ? gHost.backend->view(target->below) : nil;
    if (top != nil && below != nil && gSwipe.swipe.begin(target, NSWidth(top.bounds), rightToLeft)) {
      endSwipe();
      gSwipe.top = top;
      gSwipe.below = below;
      gSwipe.window = window;
      gSwipe.surface = *surface;
      gSwipe.rightToLeft = rightToLeft;
      gSwipe.swallowMomentum = true;
      drawSwipe(gSwipe.swipe.moved(dx));
      return nil;
    }
  }
  auto bounds = ngn::swipeBounds(canGoBack, canGoForward, rightToLeft);
  if (bounds == ngn::SwipeBounds{}) {
    return event;
  }
  [event trackSwipeEventWithOptions:NSEventSwipeTrackingLockDirection
           dampenAmountThresholdMin:bounds.min
                                max:bounds.max
                       usingHandler:^(CGFloat amount, NSEventPhase phase, BOOL complete, BOOL *stop) {
                         if (phase == NSEventPhaseEnded && amount != 0) {
                           navigate(*ngn::navigationFor(
                                        amount > 0 ? ngn::NavigationInput::SwipeRight : ngn::NavigationInput::SwipeLeft,
                                        rightToLeft),
                                    window);
                         }
                       }];
  return event;
}

// An app that renders on its own surface rather than opening windows (one that is not an
// ng-native app with AppWindows) gets that surface in a window once it has something on it.
void showAppWindow();

// A launch counts once its window has been up kLaunchSuccessSeconds (launch-frame.h).
void markLaunchSucceededLater(uint64_t generation) {
  if (!gHost.updates || !gHost.updates->running()) {
    return;
  }
  // For this launch only: a reload since begins another, with a timer of its own.
  int64_t delay = static_cast<int64_t>(ngn::kLaunchSuccessSeconds * NSEC_PER_SEC);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, delay), dispatch_get_main_queue(), ^{
    gHost.updates->markLaunchSucceeded(generation);
  });
}

// Whether the surface has content on screen in `window`.
bool showsContent(SurfaceId surface, NSWindow *window) {
  const auto *root = gHost.mounting->tree().find(surface);
  return window != nil && window.visible && root != nullptr && !root->children.empty();
}

// A window shows the surface's content: the launch's first, mounted by its own JavaScript instance
// while it is still the launch running, starts the launch's success timer. Main thread.
void launchFrameShown(SurfaceId surface, NSWindow *window) {
  if (!gHost.updates || !showsContent(surface, window)) {
    return;
  }
  if (auto generation = gHost.launchFrame.shown(gHost.mounting->mountedBy(surface), gHost.updates->launchGeneration())) {
    markLaunchSucceededLater(*generation);
  }
}

// A reload's bundle (the launch `generation`) loaded into the JavaScript instance `instance`: its
// launch counts from its first frame on screen, which may already be there or come with a later
// mount. Main thread.
void reloadLaunched(uint64_t generation, uint64_t instance) {
  gHost.launchFrame.loaded(generation, instance);
  launchFrameShown(kAppSurface, gHost.appWindow);
  for (NSWindow *window in NSApp.windows) {
    if (SurfaceId surface = gHost.windows ? gHost.windows->surfaceOf(window) : 0) {
      launchFrameShown(surface, window);
    }
  }
}

// The menu's or the red box's reload: the same launch, in a new instance. Its first frame, if still
// owed, comes from that instance once the bundle loads; the instance it replaces owes nothing from
// now, and nothing does if the bundle does not load. Main thread.
void reloadSameLaunch() {
  uint64_t generation = gHost.updates ? gHost.updates->launchGeneration() : 0;
  gHost.launchFrame.reloadBegan();
  gHost.runtime->reload([generation](bool loaded) {
    if (!loaded) {
      fprintf(stderr, "ngn-macos: the reload could not load the bundle\n");
      return;
    }
    uint64_t instance = gHost.mounting->instance();
    dispatch_async(dispatch_get_main_queue(), ^{
      reloadLaunched(generation, instance);
    });
  });
}

// The splash screen: the first windows wait for the app to hide it (NgNativeSplashScreen).
std::shared_ptr<ngn::SplashGate> gSplash = std::make_shared<ngn::SplashGate>();

// Runs a window's first show now, or on the main thread once the app hides the splash screen.
void showPastSplash(std::function<void()> show) {
  gSplash->show([show = std::move(show)] {
    if (NSThread.isMainThread) {
      show();
    } else {
      dispatch_async(dispatch_get_main_queue(), ^{
        show();
      });
    }
  });
}

void showAppSurfaceIfUsed() {
  const auto *root = gHost.mounting->tree().find(kAppSurface);
  if (gHost.appWindow != nil || root == nullptr || root->children.empty()) {
    return;
  }
  NSRect visible = NSScreen.mainScreen.visibleFrame;
  gHost.appWindow = [[NSWindow alloc]
      initWithContentRect:gHost.appSurface.frame
                styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable |
                          NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskFullSizeContentView
                  backing:NSBackingStoreBuffered
                    defer:NO];
  gHost.appWindow.releasedWhenClosed = NO;
  gHost.appWindow.title = gHost.title;
  gHost.appWindow.delegate = (id<NSWindowDelegate>)NSApp.delegate;
  gHost.appWindow.contentView = gHost.appSurface;
  [gHost.appWindow setFrameTopLeftPoint:NSMakePoint(NSMinX(visible) + 40, NSMaxY(visible) - 40)];
  // Shown once the content has the insets of the title bar and toolbar it runs under and its native
  // controls their measured sizes, a commit or two later, or after kSettleWait at the latest: shown
  // at once, its first frames would draw under the toolbar and then jump down.
  constexpr int64_t kSettleWait = 300 * NSEC_PER_MSEC;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kSettleWait), dispatch_get_main_queue(), ^{
    showAppWindow();
  });
}

// SIGTERM (a test pool ending its run, or `kill`) ends the host as a clean quit does, after asking
// the app to run its `willQuit` hooks, though not its `canClose` guards, for at most
// WindowHost::kTerminateSeconds: the programs it started go with it and a test launch removes what
// it leaves behind. A main thread that does not get to it within kTermWait is not waited for.
void endOnTerminateSignal() {
  constexpr int64_t kTermWait = 2500 * NSEC_PER_MSEC;
  signal(SIGTERM, SIG_IGN);
  static dispatch_source_t source =
      dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0));
  dispatch_source_set_event_handler(source, ^{
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kTermWait), dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      _exit(0);
    });
    dispatch_async(dispatch_get_main_queue(), ^{
      auto end = [] {
        [NSApp.delegate applicationWillTerminate:[NSNotification notificationWithName:NSApplicationWillTerminateNotification
                                                                               object:NSApp]];
        exit(0);
      };
      if (gHost.windowHost) {
        // The app's answer arrives on the JavaScript thread; the host ends on the main one.
        gHost.windowHost->terminateRequested([end] { dispatch_async(dispatch_get_main_queue(), end); });
      } else {
        end();
      }
    });
  });
  dispatch_resume(source);
}

void showAppWindow() {
  if (gHost.appWindowShown || gHost.appWindow == nil) {
    return;
  }
  gHost.appWindowShown = true;
  showPastSplash([] {
    ngn::appkit::showWindow(gHost.appWindow);
    logFirstFrame(gHost.appWindow);
    launchFrameShown(kAppSurface, gHost.appWindow);
  });
}

} // namespace

// The source of a `[dragItem]` view's drag out: a file url per file, and the text and url on one
// more item. Finder takes the files, a text field the text, a browser the url. The picks the files
// read stay open until the session ends.
@interface NGNDragOutSource : NSObject <NSDraggingSource>
+ (void)begin:(const ngn::DragOutItem &)item from:(NSView *)view event:(NSEvent *)event;
@end

@implementation NGNDragOutSource {
  std::vector<std::shared_ptr<ngn::FileAccess::Use>> _uses;
}
+ (void)begin:(const ngn::DragOutItem &)item from:(NSView *)view event:(NSEvent *)event {
  static NGNDragOutSource *source = [NGNDragOutSource new];
  // The view as it is drawn, under the pointer where the press started.
  NSBitmapImageRep *rep = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
  NSImage *image = nil;
  if (rep != nil) {
    [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
    image = [[NSImage alloc] initWithSize:view.bounds.size];
    [image addRepresentation:rep];
  }
  NSMutableArray<NSDraggingItem *> *items = [NSMutableArray array];
  auto add = [&](id<NSPasteboardWriting> writer) {
    NSDraggingItem *dragging = [[NSDraggingItem alloc] initWithPasteboardWriter:writer];
    [dragging setDraggingFrame:view.bounds contents:image];
    [items addObject:dragging];
  };
  for (const auto &file : item.files) {
    if (NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:file.c_str()]]) {
      add(url);
    }
  }
  if (item.text || item.url) {
    NSPasteboardItem *extra = [NSPasteboardItem new];
    if (item.url) {
      [extra setString:[NSString stringWithUTF8String:item.url->c_str()] forType:NSPasteboardTypeURL];
    }
    const std::string &text = item.text ? *item.text : *item.url;
    [extra setString:[NSString stringWithUTF8String:text.c_str()] forType:NSPasteboardTypeString];
    add(extra);
  }
  if (items.count > 0) {
    source->_uses = item.uses;
    [view beginDraggingSessionWithItems:items event:event source:source];
  }
}
- (NSDragOperation)draggingSession:(NSDraggingSession *)session
    sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
  return NSDragOperationCopy | NSDragOperationGeneric;
}
- (void)draggingSession:(NSDraggingSession *)session
           endedAtPoint:(NSPoint)screenPoint
              operation:(NSDragOperation)operation {
  _uses.clear();
}
@end

@interface NGNAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate>
@end

@implementation NGNAppDelegate {
  BOOL _launched;
}
- (NSUndoManager *)windowWillReturnUndoManager:(NSWindow *)window {
  return ngn::appkit::undoManagerFor(window);
}
- (void)applicationDidFinishLaunching:(NSNotification *)note {
  _launched = YES;
}
// Open With, a drop on the Dock icon and a double click on one of the app's document types in
// Finder: each file reaches Linking (DeepLinks) as its file:// url. Links to the app's scheme come
// through the AppleEvent handler (system.mm) instead.
- (void)application:(NSApplication *)app openURLs:(NSArray<NSURL *> *)urls {
  for (NSURL *url in urls) {
    NSURL *plain = url.isFileReferenceURL ? url.filePathURL : url;
    if (plain.absoluteString != nil && gHost.state) {
      gHost.state->receiveUrl(plain.absoluteString.UTF8String, _launched);
    }
  }
}
// The app decides (AppWindows and provideAppLifecycle): closing the last window never quits.
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app {
  return gHost.appWindow != nil;
}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
  switch (gHost.windowHost->quitRequested()) {
    case ngn::QuitReply::Now:
      return NSTerminateNow;
    case ngn::QuitReply::Later:
      return NSTerminateLater;
    case ngn::QuitReply::Cancel:
      return NSTerminateCancel;
  }
  return NSTerminateNow;
}
// The app's own items above the Dock menu's standard ones.
- (NSMenu *)applicationDockMenu:(NSApplication *)sender {
  return gHost.dock ? gHost.dock->menu() : nil;
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
  gHost.windowHost->reopen(visible);
  return YES;
}
// APNs' answers to registerForRemoteNotifications (push.mm), for the core's PushTokens.
- (void)application:(NSApplication *)app didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)token {
  if (gHost.push) {
    gHost.push->registered(std::string(static_cast<const char *>(token.bytes), token.length));
  }
}
- (void)application:(NSApplication *)app didFailToRegisterForRemoteNotificationsWithError:(NSError *)error {
  if (gHost.push) {
    gHost.push->failed(error.localizedDescription.UTF8String);
  }
}
// Every remote notification while the app runs. One with an alert is heard through the
// notification centre's delegate as it is presented (notifications.mm); a silent one only here.
- (void)application:(NSApplication *)app didReceiveRemoteNotification:(NSDictionary<NSString *, id> *)userInfo {
  auto payload = ngn::appkit::pushPayload(userInfo);
  if (gHost.notificationEvents && ngn::silentPush(payload)) {
    gHost.notificationEvents->received(
        NSDate.date.timeIntervalSince1970 * 1000, ngn::remoteNotificationRequest(NSUUID.UUID.UUIDString.UTF8String, payload));
  }
}
- (void)applicationWillTerminate:(NSNotification *)note {
  ngn::appkit::endTestLaunch();
  // A clean quit is no crash: the update running is not rolled back, however soon it quit.
  if (gHost.updates) {
    gHost.updates->markLaunchSucceeded();
  }
  // The programs the app started go with it, rather than run on with no one to read them.
  if (gHost.launcher) {
    gHost.launcher->killAll(SIGKILL);
  }
  // Stop the surfaces and the runtime before exit tears down what they still use.
  if (gHost.runtime) {
    gHost.runtime->shutdown();
  }
  // The surface views still hold the input sink as exit destroys the host: it lives on until the
  // process ends, so none of them reaches a sink that is gone.
  (void)gHost.input.release();
}
// The app's own surface, when it is in a window.
- (void)windowDidResize:(NSNotification *)note {
  if (gHost.runtime) {
    gHost.runtime->updateSurface(kAppSurface, metricsFor(gHost.appWindow));
  }
  gHost.state->metrics.set(windowMetrics(gHost.appWindow));
}
- (void)windowDidChangeBackingProperties:(NSNotification *)note {
  [self windowDidResize:note];
}
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    // The values the core takes from the OS it runs on (host-os.h).
    const ngn::HostOs os = ngn::macOS();
    // What to run: argv and the environment in a dev run, and only the Info.plist in a packaged
    // app (launch-settings.h).
    NSDictionary *info = NSBundle.mainBundle.infoDictionary;
    std::vector<std::string> args(argv + 1, argv + argc);
    auto launch = ngn::launchSettings({
        .args = args,
        .env = [](const std::string &name) -> std::optional<std::string> {
          const char *value = getenv(name.c_str());
          return value != nullptr ? std::optional<std::string>(value) : std::nullopt;
        },
        .plist = [info](const std::string &key) -> std::optional<std::string> {
          NSString *value = info[[NSString stringWithUTF8String:key.c_str()]];
          return [value isKindOfClass:NSString.class] ? std::optional<std::string>(value.UTF8String) : std::nullopt;
        },
        .resourcePath = NSBundle.mainBundle.resourcePath != nil ? NSBundle.mainBundle.resourcePath.UTF8String : "",
    }, os);
    if (auto *usage = std::get_if<std::string>(&launch)) {
      fprintf(stderr, "%s\n", usage->c_str());
      return 2;
    }
    static const auto settings = std::get<ngn::LaunchSettings>(launch);
    gHost.launch = &settings;
    std::string bundle = settings.bundle;
    std::string module = settings.module;
    NSString *title = [NSString stringWithUTF8String:settings.title.c_str()];
    std::string appId = settings.appId;
    std::string capabilities = settings.capabilitiesJson;
    ngn::appkit::beginTestLaunch(settings.test);

    NSApplication *app = NSApplication.sharedApplication;
    // A test launch has no Dock icon, and never takes focus, until a test asks for the key window.
    app.activationPolicy = settings.test ? NSApplicationActivationPolicyAccessory : NSApplicationActivationPolicyRegular;
    endOnTerminateSignal();
    NGNAppDelegate *delegate = [NGNAppDelegate new];
    app.delegate = delegate;

    gHost.backend = std::make_shared<ngn::appkit::AppKitBackend>();
    // The mounting manager, the input dispatcher and the gesture recognisers over the backend
    // (host-views.h), the recognisers' timers on the main queue.
    auto views = ngn::makeHostViews(
        gHost.backend, gHost.backend, [](double ms, std::function<void()> fn) -> std::function<void()> {
          auto cancelled = std::make_shared<std::atomic<bool>>(false);
          auto shared = std::make_shared<std::function<void()>>(std::move(fn));
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(ms * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
            if (!*cancelled) {
              (*shared)();
            }
          });
          return [cancelled] { *cancelled = true; };
        });
    gHost.mounting = views.mounting;
    gHost.input = std::move(views.input);
    ngn::appkit::installWorkletHost(gHost.mounting);
    // Each commit's time, for the performance budget (pnpm bench:macos), when asked for: every
    // frame of an animation commits, which would flood a dev run's terminal.
    if (settings.logCommits) {
      gHost.mounting->onCommit = [](SurfaceId, double ms) { fprintf(stderr, "[ngn] commit %.1f ms\n", ms); };
    }
    gHost.backend->onMount = [](SurfaceId surfaceId) {
      gHost.input->didMount(surfaceId);
      swipeMounted();
      if (surfaceId == kAppSurface) {
        showAppSurfaceIfUsed();
        if (gHost.mounting->safeAreasSettled() && gHost.mounting->controlSizesSettled()) {
          showAppWindow();
        }
        launchFrameShown(surfaceId, gHost.appWindow);
      } else {
        // Its first show logs the first frame and may start the success timer (the shown hook).
        gHost.windows->didMount(surfaceId);
        launchFrameShown(surfaceId, gHost.windows->window(surfaceId));
      }
    };
    gHost.input->onCursor = [](ngn::Cursor cursor) { [NGNSurfaceView showCursor:cursor]; };
    // A press that became a drag out of a `[dragItem]` view: the mouse event that crossed the
    // threshold starts the session, which has the mouse from there.
    gHost.input->onDragOut = [](Tag tag, const ngn::PointerInput &, const ngn::DragOutItem &item) {
      NSView *view = gHost.backend->view(tag);
      NSEvent *event = NSApp.currentEvent;
      if (view != nil && event != nil && event.type == NSEventTypeLeftMouseDragged) {
        [NGNDragOutSource begin:item from:view event:event];
      }
    };
    NGNModalHostView.input = gHost.input.get();
    NGNView.activator = gHost.input.get();
    // The focus into a modal as it opens: the first view in its Tab order.
    NGNModalHostView.initialFocus = [](NSInteger tag) -> NSResponder * {
      auto reach = NSApp.isFullKeyboardAccessEnabled ? ngn::TabReach::All : ngn::TabReach::TextInputs;
      auto first = ngn::nextInTabOrder(gHost.mounting->tree(), static_cast<Tag>(tag), std::nullopt, false, reach);
      NGNView *view = first ? gHost.backend->view(*first) : nil;
      return view.keyboardResponder;
    };
    NGNModalHostView.presentationChanged = [](NSInteger tag, BOOL presented) {
      if (presented) {
        gHost.mounting->tree().addContainerRoot(static_cast<Tag>(tag));
      } else {
        gHost.mounting->tree().removeContainerRoot(static_cast<Tag>(tag));
      }
    };
    NGNSurfaceView.insetsChanged = [](Tag root, std::optional<ngn::ContainerInsets> insets) {
      if (insets) {
        gHost.mounting->setContainerInsets(root, *insets);
      } else {
        gHost.mounting->removeContainerInsets(root);
      }
    };
    NGNHeaderToolbar.input = gHost.input.get();
    NGNHeaderToolbar.containerRootChanged = [](NSInteger tag, BOOL isRoot) {
      if (isRoot) {
        gHost.mounting->tree().addContainerRoot(static_cast<Tag>(tag));
      } else {
        gHost.mounting->tree().removeContainerRoot(static_cast<Tag>(tag));
      }
    };
    NGNSplitView.input = gHost.input.get();
    NGNSplitView.containerRootChanged = NGNHeaderToolbar.containerRootChanged;
    NGNSplitView.rowContentTakesClick = [](NSInteger row, NSPoint point) {
      const auto &tree = gHost.mounting->tree();
      auto chain = tree.hitTest(static_cast<Tag>(row), {static_cast<Float>(point.x), static_cast<Float>(point.y)});
      return ngn::rowContentTakesClick(tree, chain);
    };
    NGNTabsHostView.tabChosen = [](NSInteger surface, NSInteger host, NSInteger screen) {
      gHost.mounting->chooseTab(static_cast<SurfaceId>(surface), static_cast<Tag>(host), static_cast<Tag>(screen));
    };
    NGNModalHostView.sheetSizer = [](NSInteger surface, NSInteger tag, NSSize window) {
      ngn::SheetNode empty;
      auto node = gHost.runtime ? gHost.runtime->sheetNode(static_cast<SurfaceId>(surface), static_cast<Tag>(tag))
                                : std::nullopt;
      auto size = ngn::sheetSize(
          node ? *node : empty, {static_cast<Float>(window.width), static_cast<Float>(window.height)});
      return NSMakeSize(size.width, size.height);
    };
    NGNModalHostView.popoverSizer = [](NSInteger surface, NSInteger tag, NSSize window) {
      auto node = gHost.runtime ? gHost.runtime->sheetNode(static_cast<SurfaceId>(surface), static_cast<Tag>(tag))
                                : std::nullopt;
      auto size = node ? ngn::popoverSize(*node, {static_cast<Float>(window.width), static_cast<Float>(window.height)})
                       : facebook::react::Size{0, 0};
      return NSMakeSize(size.width, size.height);
    };
    NGNModalHostView.viewForTag = [](NSInteger tag) -> NSView * {
      return gHost.backend->view(static_cast<Tag>(tag));
    };
    NGNScrollView.offsetChanged = [](NSInteger tag, CGPoint offset) {
      gHost.mounting->tree().setScrollOffset(
          static_cast<Tag>(tag), {static_cast<Float>(offset.x), static_cast<Float>(offset.y)});
    };

    gHost.title = title;
    NSRect frame = NSMakeRect(0, 0, ngn::kDefaultWindowWidth, ngn::kDefaultWindowHeight);
    gHost.appSurface = [[NGNSurfaceView alloc] initWithFrame:frame surfaceId:kAppSurface input:gHost.input.get()];
    gHost.backend->addSurface(gHost.appSurface);

    if (appId.empty()) {
      appId = std::string(title.UTF8String);
    }
    auto system = ngn::appkit::makeSystem(appId);
    gHost.state = std::make_shared<ngn::HostState>();
    {
      NSSize screen = NSScreen.mainScreen.frame.size;
      double scale = NSScreen.mainScreen.backingScaleFactor;
      gHost.state->metrics.set({
          .window = {.width = frame.size.width, .height = frame.size.height, .scale = scale, .fontScale = 1},
          .screen = {.width = screen.width, .height = screen.height, .scale = scale, .fontScale = 1},
      });
    }
    if (!settings.initialUrl.empty()) {
      gHost.state->setInitialUrl(settings.initialUrl);
    }
    ngn::appkit::watchApp(gHost.state, system);
    ngn::NetworkClients network{ngn::appkit::makeHttp(), ngn::appkit::makeWebSockets()};
    // The capabilities the app declares, for the process.
    static auto processes = ngn::appkit::processesSetup(capabilities);
    static auto caches = ngn::appkit::cacheDirectory(appId);
    // The one set of rules for every path JavaScript names (FileSystem, a request body, ImageEditor
    // and the other modules that read a file): the app's folders, the user's picks, the declared
    // paths (none in a Mac App Store build, whose sandbox reaches only picks) and, for assets, a
    // packaged app's bundle.
    static auto fileAccess = [&] {
      auto folders = ngn::appkit::fileFolders(system->appDataDirectory(), caches);
      if (settings.packaged && NSBundle.mainBundle.resourcePath != nil) {
        folders.bundle = NSBundle.mainBundle.resourcePath.UTF8String;
      } else if (auto path = ngn::pathOfUri(bundle); path && !settings.packaged) {
        // A dev run of an exported bundle on disk: its assets are beside it.
        folders.bundle = [NSString stringWithUTF8String:path->c_str()].stringByDeletingLastPathComponent.UTF8String;
      }
      auto access = std::make_shared<ngn::FileAccess>(
          folders, processes.sandboxed ? folly::dynamic::array() : processes.capabilities.paths);
      // Picks persist across launches through bookmarks, one store per app; a test launch starts
      // with none and keeps none.
      if (!settings.test) {
        access->keepPicks(std::make_shared<ngn::PickStore>(
            ngn::appkit::pickPersistence("NGNPickedPaths." + appId), ngn::appkit::makeBookmarks()));
      }
      return access;
    }();
    // The views that load a source JavaScript names (images, players' views, web views, a drag out)
    // check it against the same rules.
    ngn::useViewFileAccess(fileAccess);
    // Kept for the process: ReactHost asks it for modules on every reload.
    static auto modules = std::make_shared<ngn::ModuleRegistry>();
    ngn::addCoreModules(
        *modules,
        {.system = system,
         .state = gHost.state,
         .http = network.http,
         .webSockets = network.webSockets,
         .files = fileAccess,
         .reactNativeVersion = NGN_REACT_NATIVE_VERSION,
         .bundle = [] {
           std::lock_guard lock(gBundleMutex);
           return gBundle;
         },
         // VoiceOver goes where the layout-changed notification points it; a view that takes the
         // keyboard takes it too, as setAccessibilityFocus moves both on iOS's keyboard.
         .focusAccessibility = [](int tag) {
           dispatch_async(dispatch_get_main_queue(), ^{
             NGNView *view = gHost.backend ? gHost.backend->view(tag) : nil;
             if (view == nil || view.window == nil) {
               return;
             }
             if (view.acceptsFirstResponder) {
               [view.window makeFirstResponder:view];
             }
             NSAccessibilityPostNotificationWithUserInfo(
                 view.window, NSAccessibilityLayoutChangedNotification, @{NSAccessibilityUIElementsKey : @[ view ]});
           });
         },
         .fakeSystemUI = settings.test && settings.test->fakeSystemUI,
         .gestures = views.gestures,
         .runOnUiThread = [](std::function<void()> task) {
           auto shared = std::make_shared<std::function<void()>>(std::move(task));
           dispatch_async(dispatch_get_main_queue(), ^{
             (*shared)();
           });
         }});

    gHost.windows = std::make_shared<ngn::appkit::AppKitWindows>(ngn::appkit::AppKitWindows::Hooks{
        .makeSurface = [](SurfaceId surface, NSRect bounds) -> NGNSurfaceView * {
          NGNSurfaceView *view = [[NGNSurfaceView alloc] initWithFrame:bounds surfaceId:surface input:gHost.input.get()];
          gHost.backend->addSurface(view);
          return view;
        },
        .startSurface = [](SurfaceId surface, NSWindow *window) {
          gHost.runtime->startSurface(surface, "", metricsFor(window));
        },
        .resizeSurface = [](SurfaceId surface, NSWindow *window) {
          gHost.runtime->updateSurface(surface, metricsFor(window));
        },
        .stopSurface = [](SurfaceId surface) {
          swipeWindowClosed(surface);
          gHost.menus->forgetHistory(surface);
          gHost.runtime->stopSurface(surface);
          gHost.backend->removeSurface(surface);
        },
        .keyWindowChanged = [](NSWindow *window) { gHost.state->metrics.set(windowMetrics(window)); },
        .whenShown = [](std::function<void()> show) { showPastSplash(std::move(show)); },
        // Shown once the splash lets it go, which may be after its last commit: the first frame's
        // actions and the launch's success timer start from here.
        .shown =
            [](NSWindow *window) {
              logFirstFrame(window);
              launchFrameShown(gHost.windows->surfaceOf(window), window);
            },
    });
    gHost.windowHost = std::make_shared<ngn::WindowHost>(gHost.windows, system);
    gHost.windows->setHost(gHost.windowHost);

    gHost.menus = std::make_shared<ngn::MenuHost>(
        std::make_shared<AppKitMenus>(),
        ngn::DefaultMenuOptions{
            .appName = std::string(title.UTF8String),
            .developer = ngn::DevServer::fromBundleUrl(bundle).has_value(),
            .os = os});
    // Each window's history, as the app's router reports it, for its toolbar's chevrons.
    gHost.menus->historyChanged = [](SurfaceId surface) {
      dispatch_async(dispatch_get_main_queue(), ^{
        gHost.backend->setHistory(surface, gHost.menus->history(surface));
      });
    };
    gHost.backend->historyOf = [](SurfaceId surface) { return gHost.menus->history(surface); };
    NGNHeaderToolbar.navigate = [](NSWindow *window, ngn::NavigationDirection direction, int steps) {
      gHost.menus->navigate(direction, surfaceOf(window), steps);
    };
    // File > Print with no print item of the app's: what the window shows (printing.h).
    gHost.menus->printWindow = [](std::optional<SurfaceId> surface) {
      NSWindow *window = surface ? (*surface == kAppSurface ? gHost.appWindow : gHost.windows->window(*surface)) : nil;
      ngn::appkit::printWindow(window != nil ? window : NSApp.keyWindow, false, [](const std::string &error) {
        if (!error.empty()) {
          fprintf(stderr, "[ngn] print: %s\n", error.c_str());
        }
      });
    };
    gHost.tray = std::make_shared<ngn::TrayHost>(std::make_shared<ngn::appkit::AppKitTray>(
        [](const std::string &icon) { gHost.tray->press(icon); },
        [](const std::string &icon, const std::string &id) { gHost.tray->menuSelect(icon, id); }));
    gHost.dock = std::make_shared<ngn::appkit::AppKitDock>([](const std::string &id) { gHost.dockHost->menuSelect(id); });
    gHost.dockHost = std::make_shared<ngn::DockHost>(gHost.dock);
    // The secrets' store: a test launch's own items, removed as it ends, and any a crashed run left.
    std::shared_ptr<ngn::SecretStore> keychain = ngn::appkit::makeKeychain();
    if (settings.test) {
      ngn::appkit::removeStaleTestItems(*settings.test);
      auto prefixed = std::make_shared<ngn::PrefixedSecretStore>(keychain, settings.test->keychainPrefix());
      ngn::appkit::onTestLaunchEnd([prefixed] { prefixed->clear(); });
      keychain = prefixed;
    }
    // A bundle on disk runs the newest update the Expo Updates client keeps, when the app has an
    // updates URL; one from a dev server never does.
    bool fromDevServer = ngn::DevServer::fromBundleUrl(bundle).has_value();
    gHost.updates = std::make_shared<ngn::UpdatesClient>(
        ngn::updatesConfigFrom(settings, os, system->appDataDirectory(), bundle), network.http, ngn::appkit::makeUpdateCrypto());
    if (!fromDevServer && gHost.updates->enabled()) {
      bundle = gHost.updates->launch();
      if (auto running = gHost.updates->running()) {
        fprintf(stderr, "[ngn] running update %s\n", running->id.c_str());
      }
    }
    // The map and camera views reach the same location service and camera as their modules.
    auto location = ngn::appkit::makeLocationSource();
    auto cameraHardware = ngn::appkit::makeCameraHardware();
    // A rating prompt only in a Mac App Store build: one sandboxed but shipped another way has none.
    auto packaged = ngn::appkit::packagedApp();
    // The desktop host's own modules over AppKit's sources (desktop-modules.h).
    auto desktop = ngn::addDesktopModules(
        *modules,
        {.os = os,
         .system = system,
         .state = gHost.state,
         .http = network.http,
         .files = fileAccess,
         .appId = appId,
         .appName = std::string(title.UTF8String),
         .caches = caches,
         .noPrompts = settings.noPrompts,
         .windows = gHost.windowHost,
         .menus = gHost.menus,
         .tray = gHost.tray,
         .dock = gHost.dockHost,
         .processes = processes,
         .shell = ngn::appkit::makeShellOpener(),
         .secrets = keychain,
         .sleep = ngn::appkit::makeSleepPreventer(),
         .haptics = ngn::appkit::makeHapticPlayer(),
         .notifications = ngn::appkit::makeNotificationCenter,
         .push = ngn::appkit::makePushRegistrar(),
         .undo = ngn::appkit::makeUndoManager(),
         .fileDialogs = settings.test && settings.test->fakeSystemUI ? ngn::makeDismissedFileDialogs()
                                                                     : ngn::appkit::makeFileDialogs(),
         .fileWatcher = ngn::appkit::makeFileWatcher(),
         .location = location,
         .geocoder = ngn::appkit::makeGeocoder(),
         .authenticator = ngn::appkit::makeAuthenticator(settings.noPrompts),
         .bundle = ngn::appkit::mainBundleFacts(),
         .machine = ngn::appkit::machineFacts(),
         .pathMonitor = ngn::appkit::makePathMonitor(),
         .power = ngn::appkit::makePowerSource(),
         .fontRegistrar = ngn::appkit::makeFontRegistrar(),
         .authSession = ngn::appkit::makeAuthSession(),
         .textReader = ngn::appkit::makeTextReader(),
         .calendars = ngn::appkit::makeCalendarStore(),
         .audioOutput = ngn::appkit::makeAudioOutput(),
         .audioInput = ngn::appkit::makeAudioInput(),
         .videoOutput = ngn::appkit::makeVideoOutput(),
         .languageModel = ngn::appkit::makeLanguageModelEngine(),
         .captureShield = ngn::appkit::captureShield(),
         .splash = gSplash,
         .photos = ngn::appkit::makePhotoLibrary(caches),
         .cameraHardware = cameraHardware,
         .cameraSheet = ngn::appkit::makeCameraSheet(),
         .tracking = ngn::appkit::makeTrackingAuthority(),
         .addressLookup = ngn::appkit::makeAddressLookup(),
         .symbolMeasurer = ngn::appkit::makeSymbolMeasurer(),
         .sharePicker = ngn::appkit::makeSharePicker(),
         .imageCodec = ngn::appkit::makeImageCodec(),
         // Sign in with Apple: available only to an app signed with its entitlement.
         .appleId = ngn::appkit::makeAppleIdProvider(),
         .printSystem = ngn::appkit::makePrintSystem([](SurfaceId surface) -> NSWindow * {
           return surface == kAppSurface ? gHost.appWindow : gHost.windows->window(surface);
         }),
         .reviewPrompt = ngn::appkit::makeReviewPrompt(packaged && packaged->distribution == "mas"),
         .crypto = ngn::appkit::makeCryptoSource(),
         .locales = ngn::appkit::makeLocaleSource(),
         .regionCode = ngn::appkit::systemRegionCode,
         .updates = gHost.updates,
         .fromDevServer = fromDevServer,
         .reload =
             [](const std::string &next, std::function<void(bool)> done) {
               setRunningBundle(next);
               // The launch the module's beginReload just began.
               uint64_t generation = gHost.updates->launchGeneration();
               gHost.runtime->reload(next, [next, done, generation](bool loaded) {
                 if (!loaded) {
                   fprintf(stderr, "ngn-macos: the update's bundle %s did not load\n", next.c_str());
                 }
                 // A bundle that did not load never counts as a launch that succeeded; one that did
                 // counts from the first frame its own instance mounts on screen.
                 if (loaded) {
                   uint64_t instance = gHost.mounting->instance();
                   dispatch_async(dispatch_get_main_queue(), ^{
                     reloadLaunched(generation, instance);
                   });
                 }
                 done(loaded);
               });
             },
         // Sparkle starts with the app, as its own updater does: one for the process.
         .appUpdater = ngn::appkit::makeSparkleUpdater()});
    gHost.launcher = desktop.launcher;
    gHost.push = desktop.push;
    gHost.notificationEvents = desktop.notificationEvents;
    ngn::useFontLibrary(desktop.fonts);
    // <expo-image>'s bytes: 64 MB of them in memory, the rest on disk in the caches.
    [NGNExpoImageView useHttp:network.http cache:std::make_shared<ngn::ImageCache>(caches + "/ExpoImage", 64 << 20)];
    [NGNCameraView useHardware:cameraHardware views:desktop.cameraViews noPrompts:settings.noPrompts];
    [NGNMapView useViews:desktop.mapViews location:location];

    setRunningBundle(bundle);
    gHost.runtime = std::make_unique<ngn::Runtime>(
        gHost.mounting,
        std::make_shared<ngn::CoreTextMeasurer>(),
        std::make_shared<ngn::appkit::AppKitControlMeasurer>(),
        modules, network, bundle,
        ngn::DebuggerIdentity{
            .appId = appId,
            .deviceName = NSHost.currentHost.localizedName ? NSHost.currentHost.localizedName.UTF8String : "Mac",
            .os = os.id});
    // Each surface lays out the way I18nManager.isRTL says for the instance running, read again
    // as a reload starts the next.
    gHost.runtime->rightToLeft = [system] { return ngn::appRightToLeft(*system); };
    // The first launch owes its first frame from the instance the runtime just began.
    gHost.launchFrame.loaded(gHost.updates->launchGeneration(), gHost.mounting->instance());

    bool developer = gHost.runtime->devServer().has_value();
    if (developer) {
      const auto &server = *gHost.runtime->devServer();
      gHost.redBox = std::make_shared<ngn::RedBox>(
          ngn::appkit::makeRedBoxWindow({
              .dismiss = [] { gHost.redBox->dismiss(); },
              .reload =
                  [] {
                    gHost.redBox->reloaded();
                    reloadSameLaunch();
                  },
              .step = [](int delta) { gHost.redBox->step(delta); },
          }),
          network.http,
          server.scheme + "://" + server.host + ":" + std::to_string(server.port));
      std::weak_ptr<ngn::RedBox> redBox = gHost.redBox;
      gHost.runtime->onJsError = [redBox](const folly::dynamic &data) {
        auto box = redBox.lock();
        auto error = data.getDefault("source") == "console" ? ngn::jsErrorFromConsole(data) : ngn::jsErrorFrom(data);
        if (box && error) {
          box->report(std::move(*error));
        }
      };
      gHost.runtime->onDebuggerPaused = [](std::function<void()> resume) {
        ngn::appkit::showDebuggerPaused(std::move(resume));
      };
      gHost.runtime->onDebuggerResumed = [] { ngn::appkit::hideDebuggerPaused(); };
      gHost.runtime->onInstanceStart = [redBox] {
        if (auto box = redBox.lock()) {
          box->reloaded();
        }
      };
    }
    // VoiceOver's rotors list what the core's walk of the tree finds (accessibility.h).
    NGNSurfaceView.rotorViews = [](Tag root, ngn::AxRotor kind) -> NSArray<NSView *> * {
      NSMutableArray<NSView *> *views = [NSMutableArray array];
      for (auto tag : ngn::rotorItems(gHost.mounting->tree(), root, kind)) {
        if (NSView *view = gHost.backend->view(tag)) {
          [views addObject:view];
        }
      }
      return views;
    };
    NGNSurfaceView.contextMenuShower = [](NGNSurfaceView *view, NSEvent *event, const ngn::PointerInput &input) {
      auto target = gHost.input->contextMenuAt(input);
      if (!target) {
        return false;
      }
      Tag tag = target->tag;
      NSWindow *window = view.window;
      NSMenu *menu = ngn::appkit::buildMenu("", target->items, [tag, window](const ngn::MenuItem &item) {
        if (item.command == ngn::MenuCommand::Back || item.command == ngn::MenuCommand::Forward) {
          navigate(item.command == ngn::MenuCommand::Back ? ngn::NavigationDirection::Back
                                                          : ngn::NavigationDirection::Forward,
                   window);
        } else {
          gHost.input->contextMenuSelect(tag, item.id);
        }
      });
      [NSMenu popUpContextMenu:menu withEvent:event forView:view];
      return true;
    };

    ngn::onLayoutAnimationsRunning([](bool running) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (running && gHost.animationTimer == nil) {
          gHost.animationTimer = [NSTimer timerWithTimeInterval:1.0 / 120
                                                        repeats:YES
                                                          block:^(NSTimer *) {
                                                            if (gHost.runtime) {
                                                              gHost.runtime->animationTick();
                                                            }
                                                          }];
          [NSRunLoop.mainRunLoop addTimer:gHost.animationTimer forMode:NSRunLoopCommonModes];
        } else if (!running) {
          [gHost.animationTimer invalidate];
          gHost.animationTimer = nil;
        }
      });
    });

    // The event beat: React Native's RunLoopObserverManager wants a tick when the UI thread is about
    // to go idle, which is the main run loop about to wait (the approach Basalt takes).
    CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(
        kCFAllocatorDefault, kCFRunLoopBeforeWaiting, true, 2000000, ^(CFRunLoopObserverRef, CFRunLoopActivity) {
          if (gHost.runtime) {
            gHost.runtime->beat();
          }
        });
    CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);

    if (!gHost.runtime->loadBundle()) {
      if (developer) {
        fprintf(stderr,
                "ngn-macos: could not load %s. Is the dev server running? Start it with npm start.\n",
                bundle.c_str());
      } else {
        fprintf(stderr, "ngn-macos: could not load %s\n", bundle.c_str());
      }
      return 1;
    }
    gHost.runtime->startSurface(
        kAppSurface, module, metricsFor(frame.size, NSScreen.mainScreen.backingScaleFactor));

    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
                                          handler:^NSEvent *(NSEvent *event) {
                                            // The app's shortcuts come before the menus' keys.
                                            if (gHost.menus->keyDown(chordOf(event), textInputFocused(event.window))) {
                                              return nil;
                                            }
                                            constexpr unsigned short kTab = 48;
                                            auto mods = event.modifierFlags &
                                                (NSEventModifierFlagCommand | NSEventModifierFlagControl);
                                            if (event.keyCode == kTab && mods == 0 && moveFocus(event)) {
                                              return nil;
                                            }
                                            if (moveInComposite(event)) {
                                              return nil;
                                            }
                                            return event;
                                          }];
    // A chevron's history list on a secondary click (a long press is the control's own).
    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskRightMouseDown
                                          handler:^NSEvent *(NSEvent *event) {
                                            return [NGNHeaderToolbar showHistoryMenuForEvent:event] ? nil : event;
                                          }];
    // Back and forward from the mouse's side buttons and the trackpad.
    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskOtherMouseDown
                                          handler:^NSEvent *(NSEvent *event) {
                                            auto input = event.buttonNumber == 3 ? ngn::NavigationInput::MouseButton4
                                                : event.buttonNumber == 4        ? ngn::NavigationInput::MouseButton5
                                                                                 : std::optional<ngn::NavigationInput>{};
                                            if (!input) {
                                              return event;
                                            }
                                            navigate(*ngn::navigationFor(*input), event.window);
                                            return nil;
                                          }];
    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskSwipe
                                          handler:^NSEvent *(NSEvent *event) {
                                            if (event.deltaX == 0) {
                                              return event;
                                            }
                                            auto input = event.deltaX > 0 ? ngn::NavigationInput::SwipeRight
                                                                          : ngn::NavigationInput::SwipeLeft;
                                            navigate(*ngn::navigationFor(input, swipesRightToLeft()), event.window);
                                            return nil;
                                          }];
    // "Swipe between pages" with two fingers (swipeScroll), for real scrolls and replayed ones.
    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel
                                          handler:^NSEvent *(NSEvent *event) {
                                            return swipeScroll(event, event.window);
                                          }];
    ngn::appkit::setReplayScrollMonitor([](NSEvent *event, NSWindow *window) { return swipeScroll(event, window); });
    if (!settings.test) {
      [app activateIgnoringOtherApps:YES];
    }
    [app run];
  }
  return 0;
}
