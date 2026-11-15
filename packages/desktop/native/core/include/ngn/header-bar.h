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

// A header's search field (react-native-screens' RNSSearchBar), drawn as the window's
// NSSearchToolbarItem. The text is not a prop: JavaScript sets it with the setText command.
struct SearchBarConfig {
  std::string placeholder;
  // "systemDefault", "none", "words", "sentences" or "characters".
  std::string autoCapitalize;
  // The caret.
  facebook::react::SharedColor tintColor;
  // The typed text.
  facebook::react::SharedColor textColor;
  bool operator==(const SearchBarConfig &) const = default;
};

// What the user did in a search field.
enum class SearchBarInput { Typed, Submitted, Cancelled, Began, Ended };

struct SearchBarEvent {
  std::string name;
  folly::dynamic payload;
};

// The events RNSSearchBar sends on iOS for `input`, with the field's text after it: Return is the
// search button, Escape the Cancel button (which empties the field first). iOS sends no `open` or
// `close`, so neither does this.
std::vector<SearchBarEvent> searchBarEvents(SearchBarInput input, const std::string &text);

// A command JavaScript sends a search bar (react-native-screens' RNSSearchBar commands).
struct SearchBarCommand {
  enum Kind { Focus, Blur, ClearText, SetText, Cancel } kind;
  std::string text;
};

// The command `name` with `args`, or nothing for one the desktop does not act on:
// toggleCancelButton (a toolbar field has no Cancel button to show) and setText without a string.
std::optional<SearchBarCommand> searchBarCommand(const std::string &name, const folly::dynamic &args);

// The bar buttons in a headerLeftBarButtonItems or headerRightBarButtonItems list. An entry that
// is not an object is skipped. Colours are processed colour integers.
std::vector<BarButton> barButtons(const std::vector<folly::dynamic> &items);

// The header a RNSScreenStackHeaderConfig's props describe, or nothing for other props or a host
// built without react-native-screens (library-glue.h).
std::optional<HeaderBar> headerBar(const facebook::react::Props &props);

// Where a RNSScreenStackHeaderSubview sits: "left", "right", "center", "back" or "searchBar".
// Nothing for other props, or without react-native-screens.
std::optional<std::string> headerItemType(const facebook::react::Props &props);

// The search field a RNSSearchBar's props describe, or nothing for other props or without
// react-native-screens.
std::optional<SearchBarConfig> searchBarConfig(const facebook::react::Props &props);

} // namespace ngn
