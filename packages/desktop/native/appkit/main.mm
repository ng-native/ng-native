// ngn-macos: the macOS desktop host. Loads a bundle into one runtime and mounts its surface in a
// window.
//
//   ngn-macos <bundle> [--module <name>] [--title <title>] [--app-id <id>]
//
// <bundle> is a JavaScript or Hermes bytecode file on disk, or a Metro bundle URL, which turns on
// the dev loop: reload and Fast Refresh from the dev server, and the Developer menu. The module
// defaults to "main", the name an ng-native app registers. The app id names the app's data and
// preferences until it is packaged with a bundle identifier (default: the title).
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

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
#include "ngn/runtime.h"

#include <sys/sysctl.h>
#include <unistd.h>

using namespace facebook::react;

namespace {

constexpr SurfaceId kMainSurface = 1;

struct Host {
  std::shared_ptr<ngn::appkit::AppKitBackend> backend;
  std::shared_ptr<ngn::MountingManager> mounting;
  std::unique_ptr<ngn::InputDispatcher> input;
  std::shared_ptr<ngn::HostState> state;
  std::unique_ptr<ngn::Runtime> runtime;
  NSWindow *window;
  NGNSurfaceView *surface;
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

ngn::SurfaceMetrics metricsFor(NSWindow *window) {
  NSSize size = window.contentView.bounds.size;
  return {
      .size = {static_cast<Float>(size.width), static_cast<Float>(size.height)},
      .pointScale = static_cast<float>(window.backingScaleFactor),
      .fontScale = 1,
  };
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

void logFirstFrame(SurfaceId surfaceId) {
  if (gHost.firstFrameLogged || surfaceId != kMainSurface) {
    return;
  }
  gHost.firstFrameLogged = true;
  // Draw now rather than at the end of this run loop pass, so the time covers the first frame.
  [gHost.window displayIfNeeded];
  [CATransaction flush];
  fprintf(stderr, "[ngn] first frame %.0f ms after launch\n", msSinceLaunch());
}

} // namespace

@interface NGNAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate>
@end

@implementation NGNAppDelegate
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app {
  return YES;
}
- (void)applicationWillTerminate:(NSNotification *)note {
  // Stop the surfaces and the runtime before exit tears down what they still use.
  if (gHost.runtime) {
    gHost.runtime->shutdown();
  }
}
- (void)windowDidResize:(NSNotification *)note {
  if (gHost.runtime) {
    gHost.runtime->updateSurface(kMainSurface, metricsFor(gHost.window));
  }
  gHost.state->metrics.set(windowMetrics(gHost.window));
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
    gHost.backend->onMount = logFirstFrame;
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

    NSRect visible = NSScreen.mainScreen.visibleFrame;
    NSRect frame = NSMakeRect(0, 0, 1040, 720);
    gHost.window = [[NSWindow alloc]
        initWithContentRect:frame
                  styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable |
                            NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskFullSizeContentView
                    backing:NSBackingStoreBuffered
                      defer:NO];
    gHost.window.title = title;
    gHost.window.delegate = delegate;
    gHost.surface = [[NGNSurfaceView alloc] initWithFrame:frame surfaceId:kMainSurface input:gHost.input.get()];
    gHost.window.contentView = gHost.surface;
    gHost.backend->addSurface(gHost.surface);
    [gHost.window setFrameTopLeftPoint:NSMakePoint(NSMinX(visible) + 40, NSMaxY(visible) - 40)];

    if (appId.empty()) {
      appId = std::string(title.UTF8String);
    }
    auto system = ngn::appkit::makeSystem(appId);
    gHost.state = std::make_shared<ngn::HostState>();
    gHost.state->metrics.set(windowMetrics(gHost.window));
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

    gHost.runtime = std::make_unique<ngn::Runtime>(
        gHost.mounting, std::make_shared<ngn::CoreTextMeasurer>(), modules, network, bundle);

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
    gHost.runtime->startSurface(kMainSurface, module, metricsFor(gHost.window));

    [gHost.window makeKeyAndOrderFront:nil];
    [app activateIgnoringOtherApps:YES];
    [app run];
  }
  return 0;
}
