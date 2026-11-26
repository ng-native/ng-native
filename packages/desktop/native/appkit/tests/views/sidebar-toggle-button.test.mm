// A sidebar's `toggleButton` (header-toolbar.mm): the window's toolbar leads with the sidebar button
// unless the window's sidebar turns it off, as it is mounted, updated and replaced.
#import "../../split-view.h"

#include "mounted-views.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::parsedProps;
using ngn::testing::viewProps;

namespace {
bool hasToggle(NSWindow *window) {
  for (NSToolbarItem *item in window.toolbar.items) {
    if ([item.itemIdentifier isEqualToString:NSToolbarToggleSidebarItemIdentifier]) {
      return true;
    }
  }
  return false;
}

bool hasSeparator(NSWindow *window) {
  for (NSToolbarItem *item in window.toolbar.items) {
    if ([item.itemIdentifier isEqualToString:NSToolbarSidebarTrackingSeparatorItemIdentifier]) {
      return true;
    }
  }
  return false;
}

Props::Shared sidebarProps(bool toggle) {
  return parsedProps<ngn::SidebarComponentDescriptor>(folly::dynamic::object("toggleButton", toggle));
}
} // namespace

TEST_CASE("A window's sidebar leaves the toolbar's sidebar button out, and in again") {
  MountedViews mounted;
  struct Restore {
    ngn::InputSink *split = NGNSplitView.input;
    ~Restore() { NGNSplitView.input = split; }
  } restore;
  NGNSplitView.input = &mounted.input;
  mounted.add(MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object())));
  auto sidebar = MountedViews::shadow(6, ngn::SidebarComponentName, sidebarProps(false));
  mounted.add(sidebar, 5);
  mounted.add(MountedViews::shadow(7, ngn::SplitContentComponentName, viewProps(folly::dynamic::object())), 5);
  auto *split = (NGNSplitView *)mounted.view(5);
  // As the core places it: the split view takes the window, and the window's toolbar follows.
  mounted.backend->setSplitView(MountedViews::kSurface, 5, true);
  REQUIRE((split.ownWindow == mounted.window));
  REQUIRE((mounted.window.toolbar != nil));

  SUBCASE("mounted without it, the toolbar keeps the tracking separator") {
    CHECK_FALSE(hasToggle(mounted.window));
    CHECK(hasSeparator(mounted.window));
  }

  SUBCASE("updated") {
    mounted.update(sidebar, sidebarProps(true));
    CHECK(hasToggle(mounted.window));
    mounted.update(sidebar, sidebarProps(false));
    CHECK_FALSE(hasToggle(mounted.window));
  }

  SUBCASE("the sidebar taken away, and another put in its place") {
    mounted.mount({ShadowViewMutation::RemoveMutation(5, sidebar, 0), ShadowViewMutation::DeleteMutation(sidebar)});
    CHECK(hasToggle(mounted.window));
    // One whose toggleButton is cleared keeps the button.
    auto plain = MountedViews::shadow(
        8, ngn::SidebarComponentName, parsedProps<ngn::SidebarComponentDescriptor>(folly::dynamic::object("toggleButton", nullptr)));
    mounted.mount({ShadowViewMutation::CreateMutation(plain), ShadowViewMutation::InsertMutation(5, plain, 0)});
    CHECK(hasToggle(mounted.window));
    mounted.mount({ShadowViewMutation::RemoveMutation(5, plain, 0), ShadowViewMutation::DeleteMutation(plain)});
    auto next = MountedViews::shadow(9, ngn::SidebarComponentName, sidebarProps(false));
    mounted.mount({ShadowViewMutation::CreateMutation(next), ShadowViewMutation::InsertMutation(5, next, 0)});
    CHECK_FALSE(hasToggle(mounted.window));
  }
  [split uninstall];
}
