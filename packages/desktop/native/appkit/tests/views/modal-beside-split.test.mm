// A modal beside a window's split view (appkit-backend.mm): the split view's controller takes the
// window's content, surface and all, and a modal mounted after that still goes over the window.
#import "../../modal-host-view.h"
#import "../../split-view.h"

#include "mounted-views.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::viewProps;

TEST_CASE("A modal beside a split view that took the window opens over the window") {
  MountedViews mounted;
  // Set by the host at launch: where the panes' and the modal's containers send their input.
  // Put back on every way out, before `mounted` (and its input) goes.
  struct Restore {
    ngn::InputSink *split = NGNSplitView.input;
    ngn::InputSink *modal = NGNModalHostView.input;
    ~Restore() {
      NGNSplitView.input = split;
      NGNModalHostView.input = modal;
    }
  } restore;
  NGNSplitView.input = &mounted.input;
  NGNModalHostView.input = &mounted.input;
  auto split = MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object()));
  mounted.add(split);
  mounted.add(MountedViews::shadow(6, ngn::SidebarComponentName, viewProps(folly::dynamic::object())), 5);
  mounted.add(MountedViews::shadow(7, ngn::SplitContentComponentName, viewProps(folly::dynamic::object())), 5);
  auto *splitView = (NGNSplitView *)mounted.view(5);
  REQUIRE([splitView isKindOfClass:NGNSplitView.class]);
  [splitView placeAsWindows:YES];
  REQUIRE((splitView.ownWindow == mounted.window));
  // The root, and a view beside the split view in it, have left the window.
  mounted.add(MountedViews::shadow(8, "View", viewProps(folly::dynamic::object())));
  REQUIRE((mounted.view(8).window == nil));

  mounted.add(MountedViews::shadow(9, "ModalHostView", viewProps(folly::dynamic::object())), 8);
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:2];
  while (mounted.view(9).window == nil && deadline.timeIntervalSinceNow > 0) {
    [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  }
  CHECK((mounted.view(9).window != nil));
  [splitView uninstall];
}
