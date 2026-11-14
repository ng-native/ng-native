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

#import "notifications.h"
#import "undo.h"
#import "app-windows.h"
#import "appkit-backend.h"
#import "header-toolbar.h"
#import "menu-bar.h"
#import "modal-host-view.h"
#import "network.h"
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
#import "language-model.h"
#import "screen-capture.h"
#import "photo-library.h"
#include "ngn/splash-screen.h"
#import "store-review.h"
#import "file-system.h"
#import "tray-and-dock.h"
#import "updates.h"
#import "surface-view.h"
#include "text-layout.h"

#include "ngn/app-menus.h"
#include "ngn/core-modules.h"
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
  // The app window is ordered front once, when its safe areas settle (showAppWindowWhenSettled).
  bool appWindowShown = false;
  // The Expo Updates client, for a bundle on disk (updates.h).
  std::shared_ptr<ngn::UpdatesClient> updates;
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
}

// Tab and Shift-Tab, walked in the core (focus-order.h) over the container the focus is in, in
// place of AppKit's key-view loop. True when the focus moved.
bool moveFocus(NSEvent *event) {
  NSWindow *window = event.window;
  NSResponder *first = window.firstResponder;
  NGNSurfaceView *container = nil;
  NGNView *focused = nil;
  // A field editor stands in for its text field, inside the field's view.
  for (NSView *v = [first isKindOfClass:NSView.class] ? (NSView *)first : nil; v != nil; v = v.superview) {
    if (focused == nil && [v isKindOfClass:NGNView.class]) {
      focused = (NGNView *)v;
    }
    if ([v isKindOfClass:NGNSurfaceView.class]) {
      container = (NGNSurfaceView *)v;
      break;
    }
  }
  if (container == nil) {
    container = [window.contentView isKindOfClass:NGNSurfaceView.class] ? (NGNSurfaceView *)window.contentView : nil;
  }
  if (container == nil) {
    return false;
  }
  // Option-Tab reaches every focusable view, whatever the keyboard navigation setting.
  bool everything = NSApp.isFullKeyboardAccessEnabled || (event.modifierFlags & NSEventModifierFlagOption) != 0;
  auto reach = everything ? ngn::TabReach::All : ngn::TabReach::TextInputs;
  bool backwards = (event.modifierFlags & NSEventModifierFlagShift) != 0;
  const auto &tree = gHost.mounting->tree();
  auto count = ngn::tabOrder(tree, container.rootTag, reach).size();
  std::optional<Tag> from;
  if (focused != nil) {
    from = static_cast<Tag>(focused.reactTag);
  }
  // A control AppKit will not focus (a button, with keyboard navigation off) passes Tab on.
  for (size_t tries = 0; tries < count; tries++) {
    auto next = ngn::nextInTabOrder(tree, container.rootTag, from, backwards, reach);
    if (!next) {
      return false;
    }
    NGNView *view = gHost.backend->view(*next);
    if (view != nil && [window makeFirstResponder:view.keyboardResponder]) {
      return true;
    }
    from = next;
  }
  return false;
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

// The menu bar the core asks for, drawn on the main thread.
struct AppKitMenus final : ngn::MenuBackend {
  void setMenuBar(std::vector<ngn::MenuItem> bar) override {
    auto shared = std::make_shared<std::vector<ngn::MenuItem>>(std::move(bar));
    dispatch_async(dispatch_get_main_queue(), ^{
      ngn::appkit::installMenuBar(*shared, [](const ngn::MenuItem &item) {
        if (item.command == ngn::MenuCommand::Reload && gHost.runtime) {
          gHost.runtime->reload([](bool loaded) {
            if (!loaded) {
              fprintf(stderr, "ngn-macos: the reload could not load the bundle\n");
            }
          });
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
bool scrollsSideways(NSEvent *event) {
  NSView *hit = [event.window.contentView hitTest:[event.window.contentView.superview convertPoint:event.locationInWindow
                                                                                            fromView:nil]];
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

// An app that renders on its own surface rather than opening windows (one that is not an
// ng-native app with AppWindows) gets that surface in a window once it has something on it.
void showAppWindow();

// A launch counts once its window has been up this long: an update that crashes before then is
// rolled back at the next launch (updates.h).
constexpr int64_t kLaunchSuccessDelay = 10 * NSEC_PER_SEC;

void markLaunchSucceededLater() {
  if (!gHost.updates || !gHost.updates->running()) {
    return;
  }
  // For this launch only: a reload since begins another, with a timer of its own.
  uint64_t generation = gHost.updates->launchGeneration();
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kLaunchSuccessDelay), dispatch_get_main_queue(), ^{
    gHost.updates->markLaunchSucceeded(generation);
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
  // Shown once the content has the insets of the title bar and toolbar it runs under, a commit or
  // two later, or after kSettleWait at the latest: shown at once, its first frames would draw under
  // the toolbar and then jump down.
  constexpr int64_t kSettleWait = 300 * NSEC_PER_MSEC;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kSettleWait), dispatch_get_main_queue(), ^{
    showAppWindow();
  });
}

void showAppWindow() {
  if (gHost.appWindowShown || gHost.appWindow == nil) {
    return;
  }
  gHost.appWindowShown = true;
  showPastSplash([] {
    [gHost.appWindow makeKeyAndOrderFront:nil];
    logFirstFrame(gHost.appWindow);
    markLaunchSucceededLater();
  });
}

} // namespace

// The source of a `[dragItem]` view's drag out: a file url per file, and the text and url on one
// more item. Finder takes the files, a text field the text, a browser the url.
@interface NGNDragOutSource : NSObject <NSDraggingSource>
+ (void)begin:(const ngn::DragOutItem &)item from:(NSView *)view event:(NSEvent *)event;
@end

@implementation NGNDragOutSource
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
    [view beginDraggingSessionWithItems:items event:event source:source];
  }
}
- (NSDragOperation)draggingSession:(NSDraggingSession *)session
    sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
  return NSDragOperationCopy | NSDragOperationGeneric;
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
- (void)applicationWillTerminate:(NSNotification *)note {
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
    });
    if (auto *usage = std::get_if<std::string>(&launch)) {
      fprintf(stderr, "%s\n", usage->c_str());
      return 2;
    }
    static const auto settings = std::get<ngn::LaunchSettings>(launch);
    std::string bundle = settings.bundle;
    std::string module = settings.module;
    NSString *title = [NSString stringWithUTF8String:settings.title.c_str()];
    std::string appId = settings.appId;
    std::string capabilities = settings.capabilitiesJson;

    NSApplication *app = NSApplication.sharedApplication;
    app.activationPolicy = NSApplicationActivationPolicyRegular;
    NGNAppDelegate *delegate = [NGNAppDelegate new];
    app.delegate = delegate;

    gHost.backend = std::make_shared<ngn::appkit::AppKitBackend>();
    gHost.mounting = std::make_shared<ngn::MountingManager>(gHost.backend, gHost.backend);
    gHost.input = std::make_unique<ngn::InputDispatcher>(gHost.mounting->tree());
    // Each commit's time, for the performance budget (pnpm bench:macos), when asked for: every
    // frame of an animation commits, which would flood a dev run's terminal.
    if (const char *log = getenv("NGN_LOG_COMMITS"); log != nullptr && std::string(log) == "1") {
      gHost.mounting->onCommit = [](SurfaceId, double ms) { fprintf(stderr, "[ngn] commit %.1f ms\n", ms); };
    }
    gHost.backend->onMount = [](SurfaceId surfaceId) {
      gHost.input->didMount(surfaceId);
      if (surfaceId == kAppSurface) {
        showAppSurfaceIfUsed();
        if (gHost.mounting->safeAreasSettled()) {
          showAppWindow();
        }
      } else {
        gHost.windows->didMount(surfaceId);
        logFirstFrame(gHost.windows->window(surfaceId));
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
    ngn::appkit::watchApp(gHost.state, system);
    ngn::NetworkClients network{ngn::appkit::makeHttp(), ngn::appkit::makeWebSockets()};
    // Kept for the process: ReactHost asks it for modules on every reload.
    static auto modules = std::make_shared<ngn::ModuleRegistry>();
    ngn::addCoreModules(
        *modules,
        {.system = system,
         .state = gHost.state,
         .http = network.http,
         .webSockets = network.webSockets,
         .reactNativeVersion = NGN_REACT_NATIVE_VERSION,
         .bundle = [] {
           std::lock_guard lock(gBundleMutex);
           return gBundle;
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
          gHost.runtime->stopSurface(surface);
          gHost.backend->removeSurface(surface);
        },
        .keyWindowChanged = [](NSWindow *window) { gHost.state->metrics.set(windowMetrics(window)); },
        .whenShown = [](std::function<void()> show) { showPastSplash(std::move(show)); },
    });
    gHost.windowHost = std::make_shared<ngn::WindowHost>(gHost.windows, system);
    gHost.windows->setHost(gHost.windowHost);
    ngn::addModule(*modules, "NgNativeWindows", [] { return ngn::makeWindowsModule(gHost.windowHost); });

    gHost.menus = std::make_shared<ngn::MenuHost>(
        std::make_shared<AppKitMenus>(),
        ngn::DefaultMenuOptions{
            .appName = std::string(title.UTF8String), .developer = ngn::DevServer::fromBundleUrl(bundle).has_value()});
    ngn::addModule(*modules, "NgNativeMenus", [] { return ngn::makeMenusModule(gHost.menus); });
    gHost.tray = std::make_shared<ngn::TrayHost>(std::make_shared<ngn::appkit::AppKitTray>(
        [](const std::string &icon) { gHost.tray->press(icon); },
        [](const std::string &icon, const std::string &id) { gHost.tray->menuSelect(icon, id); }));
    ngn::addModule(*modules, "NgNativeTray", [] { return ngn::makeTrayModule(gHost.tray); });
    gHost.dock = std::make_shared<ngn::appkit::AppKitDock>([](const std::string &id) { gHost.dockHost->menuSelect(id); });
    gHost.dockHost = std::make_shared<ngn::DockHost>(gHost.dock);
    ngn::addModule(*modules, "NgNativeDock", [] { return ngn::makeDockModule(gHost.dockHost); });
    {
      // One launcher and one declaration for the process: a reload gets a new module over them.
      static auto launcher = ngn::makePosixLauncher();
      gHost.launcher = launcher;
      static auto processes = ngn::appkit::processesSetup(capabilities);
      static auto opener = ngn::appkit::makeShellOpener();
      ngn::addModule(*modules, "NgNativeProcesses", [] { return ngn::makeProcessesModule(launcher, processes); });
      ngn::addModule(*modules, "NgNativeShell", [] { return ngn::makeShellModule(opener); });
      // The desktop Expo modules (DESKTOP_MODULES in @ng-native/expo).
      static auto keychain = ngn::appkit::makeKeychain();
      static auto keychainService = appId;
      static auto expoSystem = system;
      static auto awake = std::make_shared<ngn::KeepAwakeTags>(ngn::appkit::makeSleepPreventer());
      static auto haptics = ngn::appkit::makeHapticPlayer();
      ngn::addModule(*modules, "NgNativeSecureStore", [] { return ngn::makeSecureStoreModule(keychain, keychainService); });
      ngn::addModule(*modules, "NgNativeClipboard", [] { return ngn::makeDesktopClipboardModule(expoSystem, gHost.state); });
      static auto notificationEvents = std::make_shared<ngn::NotificationEvents>();
      static auto notifications = ngn::appkit::makeNotificationCenter(notificationEvents);
      ngn::addModule(*modules, "NgNativeNotifications", [] {
        return ngn::makeNotificationsModule(notifications, notificationEvents);
      });
      static auto undo = ngn::appkit::makeUndoManager();
      ngn::addModule(*modules, "NgNativeUndo", [] { return ngn::makeUndoModule(undo); });
      ngn::addModule(*modules, "NgNativeKeepAwake", [] { return ngn::makeKeepAwakeModule(awake); });
      ngn::addModule(*modules, "NgNativeHaptics", [] { return ngn::makeHapticsModule(haptics); });
      static auto dialogs = ngn::appkit::makeFileDialogs();
      static auto caches = ngn::appkit::cacheDirectory(appId);
      // What the app may read and write: its folders, the user's picks, and the declared paths
      // (none in a Mac App Store build, whose sandbox reaches only picks).
      static auto fileAccess = std::make_shared<ngn::FileAccess>(
          ngn::appkit::fileFolders(system->appDataDirectory(), caches),
          processes.sandboxed ? folly::dynamic::array() : processes.capabilities.paths);
      static auto fileWatcher = ngn::appkit::makeFileWatcher();
      ngn::addModule(*modules, "NgNativeFileSystem", [] { return ngn::makeFileSystemModule(fileAccess, fileWatcher); });
      ngn::addModule(*modules, "NgNativeDocumentPicker", [] { return ngn::makeDocumentPickerModule(dialogs, caches, fileAccess); });
      // expo-sqlite keeps its databases in the app's documents, under SQLite; here, in its data.
      static auto databases = system->appDataDirectory() + "/SQLite";
      ngn::addModule(*modules, "NgNativeSqlite", [] { return ngn::makeSqliteModule(databases); });
      static auto location = ngn::appkit::makeLocationSource();
      static bool noPrompts = std::getenv("NGN_NO_PROMPTS") != nullptr && std::string(std::getenv("NGN_NO_PROMPTS")) == "1";
      ngn::addModule(*modules, "NgNativeLocation", [] { return ngn::makeLocationModule(location, noPrompts); });
      static auto authenticator = ngn::appkit::makeAuthenticator();
      ngn::addModule(*modules, "NgNativeLocalAuthentication", [] { return ngn::makeLocalAuthenticationModule(authenticator); });
      static auto bundleFacts = ngn::appkit::mainBundleFacts();
      static auto appName = std::string(title.UTF8String);
      ngn::addModule(*modules, "NgNativeApplication", [] { return ngn::makeApplicationModule(bundleFacts, keychainService, appName); });
      static auto machine = ngn::appkit::machineFacts();
      ngn::addModule(*modules, "NgNativeDevice", [] { return ngn::makeDeviceModule(machine); });
      static auto pathMonitor = ngn::appkit::makePathMonitor();
      ngn::addModule(*modules, "NgNativeNetwork", [] { return ngn::makeNetworkModule(pathMonitor); });
      static auto power = ngn::appkit::makePowerSource();
      ngn::addModule(*modules, "NgNativeBattery", [] { return ngn::makeBatteryModule(power); });
      // The fonts loaded stay registered for the process, so their names outlast a reload too.
      static auto fontLibrary = std::make_shared<ngn::FontLibrary>();
      static auto fontRegistrar = ngn::appkit::makeFontRegistrar();
      static auto fontHttp = network.http;
      ngn::useFontLibrary(fontLibrary);
      ngn::addModule(*modules, "NgNativeFont", [] {
        return ngn::makeFontModule(fontRegistrar, fontLibrary, fontHttp, caches + "/fonts");
      });
      static auto authSession = ngn::appkit::makeAuthSession();
      ngn::addModule(*modules, "NgNativeWebBrowser", [] { return ngn::makeWebBrowserModule(expoSystem, authSession, noPrompts); });
      static auto textReader = ngn::appkit::makeTextReader();
      ngn::addModule(*modules, "NgNativeTextRecognition", [] { return ngn::makeTextRecognitionModule(textReader); });
      static auto calendars = ngn::appkit::makeCalendarStore();
      ngn::addModule(*modules, "NgNativeCalendar", [] { return ngn::makeCalendarModule(calendars, noPrompts); });
      // Players and recorders end with the runtime: a reload stops what the app played.
      static auto audioOutput = ngn::appkit::makeAudioOutput();
      static auto audioInput = ngn::appkit::makeAudioInput();
      ngn::addModule(*modules, "NgNativeAudio", [] { return ngn::makeAudioModule(audioOutput, audioInput, caches + "/Audio", noPrompts); });
      static auto languageModel = ngn::appkit::makeLanguageModelEngine();
      ngn::addModule(*modules, "NgNativeLocalLlm", [] { return ngn::makeLocalLlmModule(languageModel); });
      ngn::addModule(*modules, "NgNativeScreenCapture", [] { return ngn::makeScreenCaptureModule(ngn::appkit::captureShield()); });
      ngn::addModule(*modules, "NgNativeSplashScreen", [] { return ngn::makeSplashScreenModule(gSplash); });
      static auto photos = ngn::appkit::makePhotoLibrary(caches);
      ngn::addModule(*modules, "NgNativeMediaLibrary", [] { return ngn::makeMediaLibraryModule(photos, noPrompts); });
      ngn::addModule(*modules, "NgNativeImagePicker", [] { return ngn::makeImagePickerModule(photos, noPrompts); });
      // A rating prompt only in a Mac App Store build, the one sandboxed.
      static auto reviewPrompt = ngn::appkit::makeReviewPrompt(processes.sandboxed);
      ngn::addModule(*modules, "NgNativeStoreReview", [] { return ngn::makeStoreReviewModule(reviewPrompt, noPrompts); });
      static auto crypto = ngn::appkit::makeCryptoSource();
      ngn::addModule(*modules, "NgNativeCrypto", [] { return ngn::makeCryptoModule(crypto); });
      static auto locales = ngn::appkit::makeLocaleSource();
      ngn::addModule(*modules, "NgNativeLocalization", [] {
        return ngn::makeLocalizationModule(locales, ngn::appkit::systemRegionCode());
      });
    }

    // A bundle on disk runs the newest update the Expo Updates client keeps, when the app has an
    // updates URL; one from a dev server never does.
    {
      bool fromDevServer = ngn::DevServer::fromBundleUrl(bundle).has_value();
      gHost.updates = std::make_shared<ngn::UpdatesClient>(
          ngn::updatesConfigFrom(settings, system->appDataDirectory(), bundle), network.http, ngn::appkit::makeUpdateCrypto());
      if (!fromDevServer && gHost.updates->enabled()) {
        bundle = gHost.updates->launch();
        if (auto running = gHost.updates->running()) {
          fprintf(stderr, "[ngn] running update %s\n", running->id.c_str());
        }
      }
      // Sparkle starts with the app, as its own updater does: one for the process.
      static auto appUpdater = ngn::appkit::makeSparkleUpdater();
      ngn::addModule(*modules, "NgNativeUpdates", [fromDevServer] {
        return ngn::makeUpdatesModule(gHost.updates, fromDevServer, [](const std::string &next, std::function<void(bool)> done) {
          setRunningBundle(next);
          gHost.runtime->reload(next, [next, done](bool loaded) {
            if (!loaded) {
              fprintf(stderr, "ngn-macos: the update's bundle %s did not load\n", next.c_str());
            }
            // A bundle that did not load never counts as a launch that succeeded.
            if (loaded) {
              dispatch_async(dispatch_get_main_queue(), ^{
                markLaunchSucceededLater();
              });
            }
            done(loaded);
          });
        }, appUpdater);
      });
    }

    setRunningBundle(bundle);
    gHost.runtime = std::make_unique<ngn::Runtime>(
        gHost.mounting,
        std::make_shared<ngn::CoreTextMeasurer>(),
        std::make_shared<ngn::appkit::AppKitControlMeasurer>(),
        modules, network, bundle);

    bool developer = gHost.runtime->devServer().has_value();
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
                                            return event;
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
                                            navigate(*ngn::navigationFor(input), event.window);
                                            return nil;
                                          }];
    // "Swipe between pages" with two fingers: a sideways scroll that nothing scrolls sideways.
    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel
                                          handler:^NSEvent *(NSEvent *event) {
                                            if (!NSEvent.isSwipeTrackingFromScrollEventsEnabled ||
                                                event.phase != NSEventPhaseBegan ||
                                                fabs(event.scrollingDeltaX) <= fabs(event.scrollingDeltaY) ||
                                                surfaceOf(event.window) == std::nullopt || scrollsSideways(event)) {
                                              return event;
                                            }
                                            NSWindow *window = event.window;
                                            [event trackSwipeEventWithOptions:NSEventSwipeTrackingLockDirection
                                                     dampenAmountThresholdMin:-1
                                                                          max:1
                                                                 usingHandler:^(CGFloat amount, NSEventPhase phase, BOOL complete, BOOL *stop) {
                                                                   if (phase == NSEventPhaseEnded && amount != 0) {
                                                                     navigate(*ngn::navigationFor(
                                                                                  amount > 0 ? ngn::NavigationInput::SwipeRight
                                                                                             : ngn::NavigationInput::SwipeLeft),
                                                                              window);
                                                                   }
                                                                 }];
                                            return event;
                                          }];
    [app activateIgnoringOtherApps:YES];
    [app run];
  }
  return 0;
}
