// A window's split view on a screen another is pushed over (appkit-backend.mm's setCovered): the
// window gets its surface back while the screen is covered, so the screen in front shows, and
// the split view takes the window again as its screen shows.
#import "../../split-view.h"

#include "mounted-views.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::parsedProps;
using ngn::testing::viewProps;

namespace {
// The sidebar's own props, as the app commits them: what the split view reads its collapse from.
Props::Shared sidebarProps(folly::dynamic raw) {
  return parsedProps<ngn::SidebarComponentDescriptor>(std::move(raw));
}
// Runs the main loop long enough for a sidebar's collapse animation to finish.
void settle() {
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.6]];
}
} // namespace

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
  mounted.add(MountedViews::shadow(6, ngn::SidebarComponentName, sidebarProps(folly::dynamic::object())), 5);
  mounted.add(MountedViews::shadow(7, ngn::SplitContentComponentName, viewProps(folly::dynamic::object())), 5);
  auto *split = (NGNSplitView *)mounted.view(5);
  [split placeAsWindows:YES];
  REQUIRE((mounted.window.contentViewController != nil));
  REQUIRE((mounted.window.contentView != mounted.surface));

  // The user drags the divider; the width comes back after the screen in front goes.
  auto *controller = (NSSplitViewController *)mounted.window.contentViewController;
  [controller.splitView setPosition:300 ofDividerAtIndex:0];
  [controller.splitView layoutSubtreeIfNeeded];
  CGFloat dragged = NSMaxX(controller.splitView.arrangedSubviews[0].frame);

  mounted.backend->setCovered(MountedViews::kSurface, 4, true);
  CHECK((mounted.window.contentViewController == nil));
  CHECK((mounted.window.contentView == mounted.surface));
  // Back in the window, the split view does not take it again while its screen is covered.
  CHECK((split.ownWindow == nil));

  mounted.backend->setCovered(MountedViews::kSurface, 4, false);
  CHECK((split.ownWindow == mounted.window));
  REQUIRE((mounted.window.contentViewController != nil));
  auto *again = (NSSplitViewController *)mounted.window.contentViewController;
  [again.splitView layoutSubtreeIfNeeded];
  CHECK(NSMaxX(again.splitView.arrangedSubviews[0].frame) == doctest::Approx(dragged).epsilon(0.02));
  [split uninstall];
}

TEST_CASE("A split view mounted under a screen that is already covered waits for the screen to show") {
  MountedViews mounted;
  struct Restore {
    ngn::InputSink *split = NGNSplitView.input;
    ~Restore() {
      NGNSplitView.input = split;
    }
  } restore;
  NGNSplitView.input = &mounted.input;
  mounted.add(MountedViews::shadow(4, "View", viewProps(folly::dynamic::object())));
  mounted.backend->setCovered(MountedViews::kSurface, 4, true);
  mounted.add(MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object())), 4);
  mounted.add(MountedViews::shadow(6, ngn::SidebarComponentName, sidebarProps(folly::dynamic::object())), 5);
  mounted.add(MountedViews::shadow(7, ngn::SplitContentComponentName, viewProps(folly::dynamic::object())), 5);
  auto *split = (NGNSplitView *)mounted.view(5);
  [split placeAsWindows:YES];
  CHECK((split.ownWindow == nil));
  CHECK((mounted.window.contentView == mounted.surface));

  mounted.backend->setCovered(MountedViews::kSurface, 4, false);
  CHECK((split.ownWindow == mounted.window));
  [split uninstall];
}

TEST_CASE("A sidebar the user collapsed, which the app's binding follows, is still collapsed after a screen in front goes") {
  MountedViews mounted;
  struct Restore {
    ngn::InputSink *split = NGNSplitView.input;
    ~Restore() {
      NGNSplitView.input = split;
    }
  } restore;
  NGNSplitView.input = &mounted.input;
  mounted.add(MountedViews::shadow(4, "View", viewProps(folly::dynamic::object())));
  mounted.add(MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object())), 4);
  auto sidebar = MountedViews::shadow(6, ngn::SidebarComponentName, sidebarProps(folly::dynamic::object()));
  mounted.add(sidebar, 5);
  mounted.add(MountedViews::shadow(7, ngn::SplitContentComponentName, viewProps(folly::dynamic::object())), 5);
  auto *split = (NGNSplitView *)mounted.view(5);
  [split placeAsWindows:YES];
  auto *controller = (NSSplitViewController *)mounted.window.contentViewController;
  REQUIRE((controller != nil));
  controller.splitViewItems[0].collapsed = YES;
  // The sidebar is controlled: the app hears the collapse and its [(collapsed)] binding follows.
  mounted.update(sidebar, sidebarProps(folly::dynamic::object("collapsed", true)));

  mounted.backend->setCovered(MountedViews::kSurface, 4, true);
  mounted.backend->setCovered(MountedViews::kSurface, 4, false);
  settle();
  auto *again = (NSSplitViewController *)mounted.window.contentViewController;
  REQUIRE((again != nil));
  CHECK(again.splitViewItems[0].collapsed);
  [split uninstall];
}

TEST_CASE("A collapse the app asks for while a screen covers the split view is there when it shows") {
  MountedViews mounted;
  // An autosave that holds the divider's frames, which the split view restores on taking the window
  // again: the app's collapse must still win over it.
  NSString *key = @"NSSplitView Subview Frames ngn-test-covered-collapse";
  struct Restore {
    ngn::InputSink *split = NGNSplitView.input;
    NSString *key;
    ~Restore() {
      NGNSplitView.input = split;
      [NSUserDefaults.standardUserDefaults removeObjectForKey:key];
    }
  } restore{.key = key};
  NGNSplitView.input = &mounted.input;
  mounted.add(MountedViews::shadow(4, "View", viewProps(folly::dynamic::object())));
  mounted.add(MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object())), 4);
  auto sidebar = MountedViews::shadow(
      6, ngn::SidebarComponentName, sidebarProps(folly::dynamic::object("autosaveName", "ngn-test-covered-collapse")));
  mounted.add(sidebar, 5);
  mounted.add(MountedViews::shadow(7, ngn::SplitContentComponentName, viewProps(folly::dynamic::object())), 5);
  auto *split = (NGNSplitView *)mounted.view(5);
  [split placeAsWindows:YES];
  auto *controller = (NSSplitViewController *)mounted.window.contentViewController;
  REQUIRE((controller != nil));
  [controller.splitView setPosition:280 ofDividerAtIndex:0];
  [controller.splitView adjustSubviews];
  settle();

  mounted.backend->setCovered(MountedViews::kSurface, 4, true);
  mounted.update(sidebar, sidebarProps(folly::dynamic::object("autosaveName", "ngn-test-covered-collapse")("collapsed", true)));
  mounted.backend->setCovered(MountedViews::kSurface, 4, false);
  settle();
  auto *again = (NSSplitViewController *)mounted.window.contentViewController;
  REQUIRE((again != nil));
  CHECK(again.splitViewItems[0].collapsed);
  [split uninstall];
}
