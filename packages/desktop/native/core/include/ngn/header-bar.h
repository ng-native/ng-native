// A native stack's header as a toolkit draws it: react-native-screens' RNSScreenStackHeaderConfig
// props, read once into plain data, so a backend needs none of the library's headers.
#pragma once

#include <react/renderer/core/Props.h>
#include <react/renderer/graphics/Color.h>

#include <folly/dynamic.h>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

// One entry of a bar button's menu: an action (with an id) or a submenu (with items).
struct HeaderMenuItem {
  std::string title;
  std::string menuId;
  std::string symbol;
  bool on{false};
  bool disabled{false};
  bool destructive{false};
  bool inlineSection{false};
  std::vector<HeaderMenuItem> items;
  bool operator==(const HeaderMenuItem &) const = default;
};

// An entry of headerLeftBarButtonItems or headerRightBarButtonItems, as RNSBarButtonItem.mm reads
// it. A press sends its id back; one with a menu opens the menu instead.
struct BarButton {
  std::string id;
  std::string title;
  std::string symbol;
  std::string accessibilityLabel;
  facebook::react::SharedColor tint;
  bool disabled{false};
  // A fixed space of this width, and nothing else.
  std::optional<double> spacing;
  std::optional<HeaderMenuItem> menu;
  bool operator==(const BarButton &) const = default;
};

struct HeaderBar {
  bool hidden{false};
  std::string title;
  facebook::react::SharedColor titleColor;
  std::string titleFontFamily;
  int titleFontSize{0};
  std::string titleFontWeight;
  // The tint of the bar's buttons, the back button's included.
  facebook::react::SharedColor color;
  facebook::react::SharedColor backgroundColor;
  bool hideBackButton{false};
  bool hideShadow{false};
  std::vector<BarButton> left;
  std::vector<BarButton> right;
  bool operator==(const HeaderBar &) const = default;
};

// The bar buttons in a headerLeftBarButtonItems or headerRightBarButtonItems list. An entry that
// is not an object is skipped. Colours are processed colour integers.
std::vector<BarButton> barButtons(const std::vector<folly::dynamic> &items);

// The header a RNSScreenStackHeaderConfig's props describe, or nothing for other props or a host
// built without react-native-screens (library-glue.h).
std::optional<HeaderBar> headerBar(const facebook::react::Props &props);

// Where a RNSScreenStackHeaderSubview sits: "left", "right", "center", "back" or "searchBar".
// Nothing for other props, or without react-native-screens.
std::optional<std::string> headerItemType(const facebook::react::Props &props);

} // namespace ngn
