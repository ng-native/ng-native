// ngn-macos: the macOS desktop host. Loads a bundle into one runtime and mounts its surface in a
// window.
//
//   ngn-macos <bundle> [--module <name>] [--title <title>]
//
// <bundle> is a JavaScript or Hermes bytecode file on disk. The module defaults to "main", the
// name an ng-native app registers.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

#import "appkit-backend.h"
#import "surface-view.h"
#include "text-layout.h"

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
  std::unique_ptr<ngn::Runtime> runtime;
  NSWindow *window;
  NGNSurfaceView *surface;
  bool firstFrameLogged = false;
};

Host gHost;

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
    for (int i = 1; i < argc; i++) {
      std::string arg = argv[i];
      if (arg == "--module" && i + 1 < argc) {
        module = argv[++i];
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
      fprintf(stderr, "usage: ngn-macos <bundle> [--module <name>] [--title <title>]\n");
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

    NSRect visible = NSScreen.mainScreen.visibleFrame;
    NSRect frame = NSMakeRect(0, 0, 1040, 720);
    gHost.window = [[NSWindow alloc]
        initWithContentRect:frame
                  styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable |
                            NSWindowStyleMaskMiniaturizable
                    backing:NSBackingStoreBuffered
                      defer:NO];
    gHost.window.title = title;
    gHost.window.delegate = delegate;
    gHost.surface = [[NGNSurfaceView alloc] initWithFrame:frame surfaceId:kMainSurface input:gHost.input.get()];
    gHost.window.contentView = gHost.surface;
    gHost.backend->addSurface(gHost.surface);
    [gHost.window setFrameTopLeftPoint:NSMakePoint(NSMinX(visible) + 40, NSMaxY(visible) - 40)];

    gHost.runtime = std::make_unique<ngn::Runtime>(
        gHost.mounting, std::make_shared<ngn::CoreTextMeasurer>(), std::make_shared<ngn::ModuleRegistry>());

    // The event beat: React Native's RunLoopObserverManager wants a tick when the UI thread is about
    // to go idle, which is the main run loop about to wait (the approach Basalt takes).
    CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(
        kCFAllocatorDefault, kCFRunLoopBeforeWaiting, true, 2000000, ^(CFRunLoopObserverRef, CFRunLoopActivity) {
          if (gHost.runtime) {
            gHost.runtime->beat();
          }
        });
    CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);

    if (!gHost.runtime->loadBundle(bundle)) {
      fprintf(stderr, "ngn-macos: could not load %s\n", bundle.c_str());
      return 1;
    }
    gHost.runtime->startSurface(kMainSurface, module, metricsFor(gHost.window));

    [gHost.window makeKeyAndOrderFront:nil];
    [app activateIgnoringOtherApps:YES];
    [app run];
  }
  return 0;
}
