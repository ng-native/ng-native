#include "ngn/header-bar.h"

#include <algorithm>

namespace ngn {

namespace {

std::string text(const folly::dynamic &item, const char *key) {
  auto *value = item.get_ptr(key);
  return value != nullptr && value->isString() ? value->getString() : std::string{};
}

bool flag(const folly::dynamic &item, const char *key) {
  auto *value = item.get_ptr(key);
  return value != nullptr && value->isBool() && value->getBool();
}

HeaderMenuItem menuItem(const folly::dynamic &item) {
  HeaderMenuItem result{
      .title = text(item, "title"),
      .menuId = text(item, "menuId"),
      .symbol = text(item, "sfSymbolName"),
      .on = text(item, "state") == "on",
      .disabled = flag(item, "disabled"),
      .destructive = flag(item, "destructive"),
      .inlineSection = flag(item, "displayInline"),
      .items = {},
  };
  if (auto *items = item.get_ptr("items"); items != nullptr && items->isArray()) {
    for (const auto &child : *items) {
      if (child.isObject() && !flag(child, "hidden")) {
        result.items.push_back(menuItem(child));
      }
    }
  }
  return result;
}

} // namespace

std::vector<BarButton> barButtons(const std::vector<folly::dynamic> &items) {
  std::vector<BarButton> result;
  for (const auto &item : items) {
    if (!item.isObject()) {
      continue;
    }
    BarButton button;
    if (auto *spacing = item.get_ptr("spacing"); spacing != nullptr && spacing->isNumber()) {
      button.spacing = spacing->asDouble();
      result.push_back(std::move(button));
      continue;
    }
    button.id = text(item, "buttonId");
    button.title = text(item, "title");
    button.symbol = text(item, "sfSymbolName");
    button.accessibilityLabel = text(item, "accessibilityLabel");
    button.disabled = flag(item, "disabled");
    if (auto *tint = item.get_ptr("tintColor"); tint != nullptr && tint->isNumber()) {
      button.tint = facebook::react::SharedColor(static_cast<int32_t>(tint->asInt()));
    }
    if (auto *menu = item.get_ptr("menu"); menu != nullptr && menu->isObject()) {
      button.menu = menuItem(*menu);
    }
    result.push_back(std::move(button));
  }
  return result;
}

std::vector<SearchBarEvent> searchBarEvents(SearchBarInput input, const std::string &text) {
  auto withText = [](const std::string &value) { return folly::dynamic::object("text", value); };
  switch (input) {
    case SearchBarInput::Typed:
      return {{"changeText", withText(text)}};
    case SearchBarInput::Submitted:
      return {{"searchButtonPress", withText(text)}};
    case SearchBarInput::Cancelled:
      return {{"cancelButtonPress", folly::dynamic::object()}, {"changeText", withText("")}};
    case SearchBarInput::Began:
      return {{"searchFocus", folly::dynamic::object()}};
    case SearchBarInput::Ended:
      return {{"searchBlur", folly::dynamic::object()}};
  }
  return {};
}

std::optional<SearchBarCommand> searchBarCommand(const std::string &name, const folly::dynamic &args) {
  if (name == "focus") {
    return SearchBarCommand{.kind = SearchBarCommand::Focus, .text = {}};
  }
  if (name == "blur") {
    return SearchBarCommand{.kind = SearchBarCommand::Blur, .text = {}};
  }
  if (name == "clearText") {
    return SearchBarCommand{.kind = SearchBarCommand::ClearText, .text = {}};
  }
  if (name == "cancelSearch") {
    return SearchBarCommand{.kind = SearchBarCommand::Cancel, .text = {}};
  }
  if (name == "setText" && args.isArray() && !args.empty() && args[0].isString()) {
    return SearchBarCommand{.kind = SearchBarCommand::SetText, .text = args[0].getString()};
  }
  return std::nullopt;
}

HeaderLayout headerLayout(const HeaderBar &bar, std::vector<HeaderSubview> subviews, bool canGoBack) {
  std::sort(subviews.begin(), subviews.end(), [](const HeaderSubview &a, const HeaderSubview &b) { return a.tag < b.tag; });
  HeaderLayout layout;
  for (const auto &subview : subviews) {
    if (subview.type == "left") {
      layout.left.push_back(subview.tag);
    } else if (subview.type == "center") {
      layout.center.push_back(subview.tag);
    } else if (subview.type == "right") {
      layout.right.push_back(subview.tag);
    } else if (subview.type == "searchBar") {
      layout.searchBars.push_back(subview.tag);
    }
  }
  layout.back = canGoBack && !bar.hideBackButton && layout.left.empty() && bar.left.empty();
  return layout;
}

} // namespace ngn
