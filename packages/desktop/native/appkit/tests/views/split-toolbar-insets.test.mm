// The insets a window's split view's content pane reports (surface-view.mm's reportInsets) as the
// window's toolbar comes and goes: the pane keeps its frame, so only its safe area changes.
#import "../../split-view.h"

#include "mounted-views.h"

#include <doctest/doctest.h>

#include <map>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::viewProps;

namespace {
// Runs the main loop until the window has laid out what the toolbar changed.
void layOut(NSWindow *window) {
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
  [window layoutIfNeeded];
}
} // namespace

TEST_CASE("A split view's content pane reports the toolbar the window gets after the pane is in it") {
  MountedViews mounted;
  std::map<Tag, ngn::ContainerInsets> reported;
  struct Restore {
    ngn::InputSink *split = NGNSplitView.input;
    std::function<void(Tag, std::optional<ngn::ContainerInsets>)> insets = NGNSurfaceView.insetsChanged;
    ~Restore() {
      NGNSplitView.input = split;
      NGNSurfaceView.insetsChanged = insets;
    }
  } restore;
  NGNSplitView.input = &mounted.input;
  NGNSurfaceView.insetsChanged = [&reported](Tag root, std::optional<ngn::ContainerInsets> insets) {
    if (insets) {
      reported[root] = *insets;
    } else {
      reported.erase(root);
    }
  };
  // The host's window: its content runs under the title bar and the toolbar.
  mounted.window.styleMask |= NSWindowStyleMaskFullSizeContentView;
  mounted.add(MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object())));
  mounted.add(MountedViews::shadow(6, ngn::SidebarComponentName, viewProps(folly::dynamic::object())), 5);
  mounted.add(MountedViews::shadow(7, ngn::SplitContentComponentName, viewProps(folly::dynamic::object())), 5);
  auto *split = (NGNSplitView *)mounted.view(5);
  REQUIRE([split isKindOfClass:NGNSplitView.class]);

  // As the core places it: the split view takes the window, and the window's toolbar follows.
  mounted.backend->setSplitView(MountedViews::kSurface, 5, true);
  REQUIRE((mounted.window.toolbar != nil));
  layOut(mounted.window);
  NSView *pane = mounted.view(7).superview;
  REQUIRE((pane != nil));
  REQUIRE(reported.contains(7));
  CHECK(reported[7].insets.top == doctest::Approx(pane.safeAreaInsets.top));
  [split uninstall];
}
