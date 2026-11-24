// An icon's SVG markup on a header's bar buttons and their menus (header-toolbar.mm), and on a
// tray icon (tray-and-dock.mm): drawn as a template image, as an SF Symbol is, and an SF Symbol
// given too wins.
#include "mounted-views.h"

#include "../../tray-and-dock.h"

#include "ngn/library-components.h"
#include "ngn/library-glue.h"
#include "ngn/screen-stacks.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::kTopHalfIcon;
using ngn::testing::MountedViews;
using ngn::testing::imageAlpha;
using ngn::testing::viewProps;

namespace {

struct HeaderProps final : ViewProps {
  ngn::HeaderBar bar;
};

Props::Shared header(std::vector<ngn::BarButton> left, std::vector<ngn::BarButton> right) {
  auto props = std::make_shared<HeaderProps>();
  props->bar.title = "Notes";
  props->bar.left = std::move(left);
  props->bar.right = std::move(right);
  return props;
}

struct Glue {
  // The libraries' own glue is installed the first time their components are asked for, which
  // would replace this one: it goes in first, and is what is restored.
  ngn::LibraryGlue saved = (ngn::libraryComponents(), ngn::libraryGlue());
  Glue() {
    ngn::libraryGlue().headerBar = [](const Props &props) -> std::optional<ngn::HeaderBar> {
      const auto *p = dynamic_cast<const HeaderProps *>(&props);
      return p ? std::optional(p->bar) : std::nullopt;
    };
  }
  ~Glue() {
    ngn::libraryGlue() = saved;
  }
};

// The toolbar item showing a bar button: a plain button's by its view's identifier, a menu's by
// its label.
NSToolbarItem *itemFor(NSWindow *window, NSString *name) {
  for (NSToolbarItem *item in window.toolbar.items) {
    if ([item.view.identifier isEqualToString:name] || [item.label isEqualToString:name]) {
      return item;
    }
  }
  return nil;
}

// An icon drawn: a template image whose top half is filled and bottom half clear.
void checkDrawn(NSImage *image, CGFloat size) {
  REQUIRE((image != nil));
  CHECK([image isTemplate]);
  CHECK(image.size.width == size);
  CHECK(imageAlpha(image, size, size / 2, 2) == doctest::Approx(1));
  CHECK(imageAlpha(image, size, size / 2, size - 3) == doctest::Approx(0));
}

} // namespace

TEST_CASE("A bar button and its menu's items draw their SVG icons as template images, and a symbol in their place") {
  Glue glue;
  MountedViews m;
  m.add(MountedViews::shadow(4, "View", viewProps(folly::dynamic::object())));
  ngn::HeaderMenuItem menu{.title = "Edit"};
  menu.items.push_back({.title = "Rename", .menuId = "rename", .svgIcon = kTopHalfIcon});
  menu.items.push_back({.title = "Delete", .menuId = "delete"});
  ngn::BarButton more{.title = "More", .svgIcon = kTopHalfIcon, .accessibilityLabel = "More", .menu = menu};
  ngn::BarButton add{.id = "add", .svgIcon = kTopHalfIcon, .accessibilityLabel = "Add"};
  auto config = MountedViews::shadow(5, "RNSScreenStackHeaderConfig", header({more}, {add}));
  m.add(config, 4);
  auto front = ngn::ScreenStacks::FrontHeader{.config = 5, .screen = 4};
  m.backend->setFrontHeader(MountedViews::kSurface, front);

  NSToolbarItem *button = itemFor(m.window, @"add");
  REQUIRE((button != nil));
  NSButton *view = (NSButton *)button.view;
  checkDrawn(view.image, 18);
  // Named for a screen reader by its label.
  CHECK([view.image.accessibilityDescription isEqualToString:@"Add"]);

  auto *menuItem = (NSMenuToolbarItem *)itemFor(m.window, @"More");
  REQUIRE([menuItem isKindOfClass:NSMenuToolbarItem.class]);
  checkDrawn(menuItem.image, 18);
  CHECK_FALSE(menuItem.showsIndicator);
  REQUIRE(menuItem.menu.numberOfItems == 2);
  checkDrawn([menuItem.menu itemAtIndex:0].image, 16);
  CHECK(([menuItem.menu itemAtIndex:1].image == nil));

  // A symbol wins, and taking the icon away leaves the title.
  add.symbol = "plus";
  more.svgIcon.clear();
  m.update(config, header({more}, {add}));
  m.backend->setFrontHeader(MountedViews::kSurface, front);
  NSImage *symbol = ((NSButton *)itemFor(m.window, @"add").view).image;
  REQUIRE((symbol != nil));
  CHECK(symbol.size.width != 18);
  menuItem = (NSMenuToolbarItem *)itemFor(m.window, @"More");
  CHECK((menuItem.image == nil));
  CHECK([menuItem.title isEqualToString:@"More"]);
}

TEST_CASE("A tray icon draws its SVG icon as a template image, under its SF Symbol and over its image asset") {
  ngn::TrayIcon icon{.id = "t0", .svgIcon = kTopHalfIcon, .image = "NSApplicationIcon", .tooltip = "Timer"};
  NSImage *image = ngn::appkit::trayIconImage(icon);
  checkDrawn(image, 18);
  CHECK([image.accessibilityDescription isEqualToString:@"Timer"]);
  icon.sfSymbol = "timer";
  CHECK(ngn::appkit::trayIconImage(icon).size.width != 18);
  icon.sfSymbol.clear();
  icon.svgIcon = "lucideTimer";
  // Markup that is no svg is no icon, and the image asset shows instead.
  CHECK((ngn::appkit::trayIconImage(icon) == [NSImage imageNamed:@"NSApplicationIcon"]));
}
