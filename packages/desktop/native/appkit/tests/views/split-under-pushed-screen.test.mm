// A window's split view on a screen another is pushed over (appkit-backend.mm's setCovered): the
// window gets its surface back while the screen is covered, so the screen in front shows, and
// the split view takes the window again as its screen shows.
#import "../../split-view.h"

#include "mounted-views.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::viewProps;

TEST_CASE("A split view gives the window back while its screen is covered, and takes it again after") {
  MountedViews mounted;
  struct Restore {
    ngn::InputSink *split = NGNSplitView.input;
    ~Restore() {
      NGNSplitView.input = split;
    }
  } restore;
  NGNSplitView.input = &mounted.input;
  // A screen holding the split view.
  mounted.add(MountedViews::shadow(4, "View", viewProps(folly::dynamic::object())));
  mounted.add(MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object())), 4);
  mounted.add(MountedViews::shadow(6, ngn::SidebarComponentName, viewProps(folly::dynamic::object())), 5);
  mounted.add(MountedViews::shadow(7, ngn::SplitContentComponentName, viewProps(folly::dynamic::object())), 5);
  auto *split = (NGNSplitView *)mounted.view(5);
  [split placeAsWindows:YES];
  REQUIRE((mounted.window.contentViewController != nil));
  REQUIRE((mounted.window.contentView != mounted.surface));

  mounted.backend->setCovered(MountedViews::kSurface, 4, true);
  CHECK((mounted.window.contentViewController == nil));
  CHECK((mounted.window.contentView == mounted.surface));
  // Back in the window, the split view does not take it again while its screen is covered.
  CHECK((split.ownWindow == nil));

  mounted.backend->setCovered(MountedViews::kSurface, 4, false);
  CHECK((split.ownWindow == mounted.window));
  CHECK((mounted.window.contentViewController != nil));
  [split uninstall];
}
