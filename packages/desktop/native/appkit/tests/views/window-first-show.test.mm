// A managed window's first show (app-windows.mm): once its content's safe areas and control sizes
// have settled, so the first frame has the title bar's insets, or after kFirstShowWait at the
// latest.
#import "../../app-windows.h"
#import "../../surface-view.h"

#include "mounted-views.h"

#include <doctest/doctest.h>

#include <memory>

using ngn::testing::MountedViews;

namespace {

ngn::appkit::AppKitWindows::Hooks hooks(const std::shared_ptr<bool> &settled) {
  return {
      .makeSurface =
          [](facebook::react::SurfaceId surface, NSRect bounds) {
            return [[NGNSurfaceView alloc] initWithFrame:bounds surfaceId:surface input:&MountedViews::input];
          },
      .startSurface = [](facebook::react::SurfaceId, NSWindow *) {},
      .resizeSurface = [](facebook::react::SurfaceId, NSWindow *) {},
      .stopSurface = [](facebook::react::SurfaceId) {},
      .keyWindowChanged = [](NSWindow *) {},
      .settled = [settled] { return *settled; },
  };
}

ngn::WindowPlacement placement() {
  return {.frame = {.x = 0, .y = 0, .width = 400, .height = 300}};
}

void runFor(double seconds) {
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]];
}

} // namespace

TEST_CASE("A window waits for its content's insets to settle before its first show") {
  [NSApplication sharedApplication];
  auto settled = std::make_shared<bool>(false);
  ngn::appkit::AppKitWindows windows(hooks(settled));
  windows.openWindow(41, ngn::WindowRequest{.titleBar = ngn::TitleBar::Hidden}, placement(), [] {});
  NSWindow *window = windows.window(41);
  REQUIRE((window != nil));

  // A mount whose safe areas are still on their way: not yet.
  windows.didMount(41);
  CHECK_FALSE(window.visible);
  // The next, settled: shown.
  *settled = true;
  windows.didMount(41);
  CHECK(window.visible);
  windows.closeWindow(41);
}

TEST_CASE("A window whose content never settles is shown after the wait anyway") {
  [NSApplication sharedApplication];
  auto settled = std::make_shared<bool>(false);
  ngn::appkit::AppKitWindows windows(hooks(settled));
  windows.openWindow(42, ngn::WindowRequest{}, placement(), [] {});
  NSWindow *window = windows.window(42);
  REQUIRE((window != nil));
  windows.didMount(42);
  CHECK_FALSE(window.visible);
  runFor(ngn::appkit::kFirstShowWait / 2);
  CHECK_FALSE(window.visible);
  runFor(ngn::appkit::kFirstShowWait);
  CHECK(window.visible);
  windows.closeWindow(42);
}
