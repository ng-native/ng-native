// ngn-macos: the macOS desktop host. Loads a bundle into one runtime, starts the app on a surface
// that is never shown, and gives each window the app opens (NgNativeWindows) a surface of its own.
//
//   ngn-macos <bundle> [--module <name>] [--title <title>] [--app-id <id>]
//
// <bundle> is a JavaScript or Hermes bytecode file on disk, or a Metro bundle URL, which turns on
// the dev loop: reload and Fast Refresh from the dev server, and the Developer menu. The module
// defaults to "main", the name an ng-native app registers. The app id names the app's data and
// preferences until it is packaged with a bundle identifier (default: the title).
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

#import "app-windows.h"
#import "appkit-backend.h"
#import "header-toolbar.h"
#import "menu-bar.h"
#import "modal-host-view.h"
#import "network.h"
#import "scroll-view.h"
#import "system.h"
#import "surface-view.h"
#include "text-layout.h"

#include "ngn/core-modules.h"
#include "ngn/default-menu.h"
#include "ngn/input-dispatcher.h"
#import "native-controls.h"
#include "ngn/focus-order.h"
#include "ngn/layout-animations.h"
#include "ngn/runtime.h"

#include <sys/sysctl.h>
#include <unistd.h>

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
  NGNSurfaceView *appSurface;
  // The app's own surface in a window, for an app that renders there instead of opening windows.
  NSWindow *appWindow;
  NSString *title;
  // Ticks the layout animations while they run, at the display's rate.
  NSTimer *animationTimer;
  bool firstFrameLogged = false;
};

Host gHost;

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

// An app that renders on its own surface rather than opening windows (one that is not an
// ng-native app with AppWindows) gets that surface in a window once it has something on it.
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
  [gHost.appWindow makeKeyAndOrderFront:nil];
}

} // namespace

@interface NGNAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate>
@end

@implementation NGNAppDelegate
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
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
  gHost.windowHost->reopen(visible);
  return YES;
}
- (void)applicationWillTerminate:(NSNotification *)note {
  // Stop the surfaces and the runtime before exit tears down what they still use.
  if (gHost.runtime) {
    gHost.runtime->shutdown();
  }
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
    std::string bundle;
    std::string module = "main";
    NSString *title = @"ng-native";
    std::string appId;
    for (int i = 1; i < argc; i++) {
      std::string arg = argv[i];
      if (arg == "--module" && i + 1 < argc) {
        module = argv[++i];
      } else if (arg == "--app-id" && i + 1 < argc) {
        appId = argv[++i];
      } else if (arg == "--title" && i + 1 < argc) {
        title = [NSString stringWithUTF8String:argv[++i]];
      } else if (bundle.empty() && arg.rfind("--", 0) != 0) {
        bundle = arg;
      } else {
        bundle.clear();
        break;
      }
    }
    if (bundle.empty()) {
      fprintf(stderr, "usage: ngn-macos <bundle> [--module <name>] [--title <title>] [--app-id <id>]\n");
      return 2;
    }

    NSApplication *app = NSApplication.sharedApplication;
    app.activationPolicy = NSApplicationActivationPolicyRegular;
    NGNAppDelegate *delegate = [NGNAppDelegate new];
    app.delegate = delegate;

    gHost.backend = std::make_shared<ngn::appkit::AppKitBackend>();
    gHost.mounting = std::make_shared<ngn::MountingManager>(gHost.backend, gHost.backend);
    gHost.input = std::make_unique<ngn::InputDispatcher>(gHost.mounting->tree());
    gHost.backend->onMount = [](SurfaceId surfaceId) {
      gHost.input->didMount(surfaceId);
      if (surfaceId == kAppSurface) {
        showAppSurfaceIfUsed();
        logFirstFrame(gHost.appWindow);
      } else {
        gHost.windows->didMount(surfaceId);
        logFirstFrame(gHost.windows->window(surfaceId));
      }
    };
    gHost.input->onCursor = [](ngn::Cursor cursor) { [NGNSurfaceView showCursor:cursor]; };
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
         .reactNativeVersion = NGN_REACT_NATIVE_VERSION});

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
    });
    gHost.windowHost = std::make_shared<ngn::WindowHost>(gHost.windows, system);
    gHost.windows->setHost(gHost.windowHost);
    ngn::addModule(*modules, "NgNativeWindows", [] { return ngn::makeWindowsModule(gHost.windowHost); });

    gHost.runtime = std::make_unique<ngn::Runtime>(
        gHost.mounting,
        std::make_shared<ngn::CoreTextMeasurer>(),
        std::make_shared<ngn::appkit::AppKitControlMeasurer>(),
        modules, network, bundle);

    bool developer = gHost.runtime->devServer().has_value();
    ngn::appkit::installMenuBar(
        ngn::defaultMenuBar({.appName = std::string(title.UTF8String), .developer = developer}),
        [](ngn::MenuCommand command) {
          if (command == ngn::MenuCommand::Reload && gHost.runtime) {
            gHost.runtime->reload([](bool loaded) {
              if (!loaded) {
                fprintf(stderr, "ngn-macos: the reload could not load the bundle\n");
              }
            });
          }
        });

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
                                            constexpr unsigned short kTab = 48;
                                            auto mods = event.modifierFlags &
                                                (NSEventModifierFlagCommand | NSEventModifierFlagControl);
                                            if (event.keyCode == kTab && mods == 0 && moveFocus(event)) {
                                              return nil;
                                            }
                                            return event;
                                          }];
    [app activateIgnoringOtherApps:YES];
    [app run];
  }
  return 0;
}
