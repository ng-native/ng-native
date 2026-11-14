#include "ngn/header-bar.h"

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

} // namespace ngn
