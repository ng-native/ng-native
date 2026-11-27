// A sidebar's `toggleButton` (header-toolbar.mm): the window's toolbar leads with the sidebar button
// unless the window's sidebar turns it off, as it is mounted, updated and replaced. With it off and
// nothing else to show, the window has no toolbar.
#import "../../split-view.h"

#include "mounted-views.h"
#include "ngn/library-components.h"
#include "ngn/library-glue.h"
#include "ngn/screen-stacks.h"

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

  SUBCASE("mounted without it, and with no header or history, the window has no toolbar") {
    CHECK((mounted.window.toolbar == nil));
    // History to go back through: the chevrons need the toolbar.
    mounted.backend->setHistory(MountedViews::kSurface, ngn::WindowHistory{.back = {"Inbox"}});
    CHECK((mounted.window.toolbar != nil));
    mounted.backend->setHistory(MountedViews::kSurface, ngn::WindowHistory{});
    CHECK((mounted.window.toolbar == nil));
    // With the button, the toolbar leads with it and the tracking separator.
    mounted.update(sidebar, sidebarProps(true));
    CHECK(hasToggle(mounted.window));
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

TEST_CASE("Two windows' toolbars change apart, one with the sidebar button and one without") {
  MountedViews first;
  MountedViews second;
  struct Restore {
    ngn::InputSink *split = NGNSplitView.input;
    ~Restore() { NGNSplitView.input = split; }
  } restore;
  NGNSplitView.input = &first.input;
  auto mountSplit = [](MountedViews &mounted, bool toggle) {
    mounted.add(MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object())));
    auto sidebar = MountedViews::shadow(6, ngn::SidebarComponentName, sidebarProps(toggle));
    mounted.add(sidebar, 5);
    mounted.add(MountedViews::shadow(7, ngn::SplitContentComponentName, viewProps(folly::dynamic::object())), 5);
    mounted.backend->setSplitView(MountedViews::kSurface, 5, true);
    return sidebar;
  };
  mountSplit(first, true);
  auto sidebar = mountSplit(second, false);
  REQUIRE(hasToggle(first.window));
  CHECK((second.window.toolbar == nil));
  // The second window's button comes and goes; the first's toolbar keeps its own items.
  NSUInteger items = first.window.toolbar.items.count;
  second.update(sidebar, sidebarProps(true));
  CHECK(hasToggle(second.window));
  second.update(sidebar, sidebarProps(false));
  CHECK((second.window.toolbar == nil));
  CHECK(first.window.toolbar.items.count == items);
  CHECK(hasToggle(first.window));
  [(NGNSplitView *)first.view(5) uninstall];
  [(NGNSplitView *)second.view(5) uninstall];
}

namespace {
// A header's bar as the library glue reads it, the glue restored after.
struct HiddenHeaderProps final : ViewProps {
  ngn::HeaderBar bar;
};
struct HeaderGlue {
  ngn::LibraryGlue saved = (ngn::libraryComponents(), ngn::libraryGlue());
  HeaderGlue() {
    ngn::libraryGlue().headerBar = [](const Props &props) -> std::optional<ngn::HeaderBar> {
      const auto *p = dynamic_cast<const HiddenHeaderProps *>(&props);
      return p ? std::optional(p->bar) : std::nullopt;
    };
  }
  ~HeaderGlue() { ngn::libraryGlue() = saved; }
};
} // namespace

TEST_CASE("A hidden header beside a sidebar without its button leaves the window with no toolbar") {
  HeaderGlue glue;
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
  // The screen's header, hidden, in front before the split view takes the window: its bar still
  // lays out the toolbar's items, none of which show.
  auto props = std::make_shared<HiddenHeaderProps>();
  props->bar.hidden = true;
  mounted.add(MountedViews::shadow(9, "RNSScreenStackHeaderConfig", props), 7);
  mounted.backend->setFrontHeader(MountedViews::kSurface, ngn::ScreenStacks::FrontHeader{.config = 9, .screen = 7});
  mounted.backend->setSplitView(MountedViews::kSurface, 5, true);
  mounted.mount({});
  CHECK((mounted.window.toolbar == nil));
  mounted.update(sidebar, sidebarProps(true));
  CHECK(hasToggle(mounted.window));
  CHECK(hasSeparator(mounted.window));
  [(NGNSplitView *)mounted.view(5) uninstall];
}
