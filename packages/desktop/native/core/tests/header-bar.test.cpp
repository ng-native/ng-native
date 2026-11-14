#include "ngn/header-bar.h"

#include <doctest/doctest.h>

using folly::dynamic;

TEST_CASE("bar buttons read as RNSBarButtonItem.mm reads them") {
  std::vector<dynamic> items{
      dynamic::object("buttonId", "save")("title", "Save")("tintColor", 0xff0000ff)("disabled", true),
      dynamic::object("spacing", 12),
      dynamic::object("buttonId", "share")("sfSymbolName", "square.and.arrow.up")("accessibilityLabel", "Share"),
      // Not an entry at all.
      dynamic("noise"),
  };
  auto buttons = ngn::barButtons(items);
  REQUIRE(buttons.size() == 3);
  CHECK(buttons[0].id == "save");
  CHECK(buttons[0].title == "Save");
  CHECK(buttons[0].disabled);
  CHECK(buttons[0].tint == facebook::react::SharedColor(static_cast<int32_t>(0xff0000ff)));
  CHECK(buttons[1].spacing == 12.0);
  CHECK(buttons[1].id.empty());
  CHECK(buttons[2].symbol == "square.and.arrow.up");
  CHECK(buttons[2].accessibilityLabel == "Share");
  CHECK_FALSE(buttons[2].tint);
  CHECK_FALSE(buttons[2].menu);
}

TEST_CASE("a bar button's menu keeps its actions and submenus, without hidden entries") {
  dynamic remove = dynamic::object("title", "Delete")("menuId", "item-1/delete")("destructive", true);
  dynamic more = dynamic::object("title", "More")("displayInline", true)("items", dynamic::array(remove));
  dynamic name = dynamic::object("title", "Name")("menuId", "item-1/name")("state", "on");
  dynamic gone = dynamic::object("title", "Gone")("menuId", "item-1/gone")("hidden", true);
  dynamic menu = dynamic::object("title", "Sort")("items", dynamic::array(name, gone, more));
  dynamic sort = dynamic::object("title", "Sort")("menu", menu);
  auto buttons = ngn::barButtons({sort});
  REQUIRE(buttons.size() == 1);
  REQUIRE(buttons[0].menu);
  const auto &m = *buttons[0].menu;
  CHECK(m.title == "Sort");
  REQUIRE(m.items.size() == 2);
  CHECK(m.items[0].menuId == "item-1/name");
  CHECK(m.items[0].on);
  CHECK(m.items[1].inlineSection);
  REQUIRE(m.items[1].items.size() == 1);
  CHECK(m.items[1].items[0].destructive);
  CHECK(m.items[1].items[0].menuId == "item-1/delete");
}
