#include "ngn/header-bar.h"

#include <doctest/doctest.h>

using folly::dynamic;

TEST_CASE("bar buttons read as RNSBarButtonItem.mm reads them") {
  std::vector<dynamic> items{
      dynamic::object("buttonId", "save")("title", "Save")("tintColor", 0xff0000ff)("disabled", true),
      dynamic::object("spacing", 12),
      dynamic::object("buttonId", "share")("sfSymbolName", "square.and.arrow.up")("accessibilityLabel", "Share"),
      dynamic::object("buttonId", "add")("svgIcon", "<svg/>"),
      // Not an entry at all.
      dynamic("noise"),
  };
  auto buttons = ngn::barButtons(items);
  REQUIRE(buttons.size() == 4);
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
  CHECK(buttons[2].svgIcon.empty());
  CHECK(buttons[3].svgIcon == "<svg/>");
}

TEST_CASE("a bar button's menu keeps its actions and submenus, without hidden entries") {
  dynamic remove = dynamic::object("title", "Delete")("menuId", "item-1/delete")("destructive", true)("svgIcon", "<svg/>");
  dynamic more = dynamic::object("title", "More")("displayInline", true)("svgIcon", "<svg id=\"more\"/>")("items", dynamic::array(remove));
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
  CHECK(m.items[1].items[0].svgIcon == "<svg/>");
  CHECK(m.items[1].svgIcon == "<svg id=\"more\"/>");
  CHECK(m.items[0].svgIcon.empty());
}

TEST_CASE("a toolbar search field reports to JavaScript as react-native-screens' iOS search bar does") {
  using ngn::SearchBarInput;
  auto names = [](SearchBarInput input, const std::string &text) {
    std::vector<std::string> out;
    for (const auto &event : ngn::searchBarEvents(input, text)) {
      out.push_back(event.name + (event.payload.isObject() && event.payload.count("text") != 0
                                      ? ":" + event.payload["text"].asString()
                                      : ""));
    }
    return out;
  };
  CHECK(names(SearchBarInput::Typed, "ab") == std::vector<std::string>{"changeText:ab"});
  CHECK(names(SearchBarInput::Submitted, "ab") == std::vector<std::string>{"searchButtonPress:ab"});
  // Cancel empties the field first, so the text it reports is empty whatever was there.
  CHECK(names(SearchBarInput::Cancelled, "ab") == std::vector<std::string>{"cancelButtonPress", "changeText:"});
  CHECK(names(SearchBarInput::Began, "ab") == std::vector<std::string>{"searchFocus"});
  CHECK(names(SearchBarInput::Ended, "ab") == std::vector<std::string>{"searchBlur"});
}

TEST_CASE("a search bar's commands read as RNSSearchBar's, and others are ignored") {
  using ngn::SearchBarCommand;
  auto focus = ngn::searchBarCommand("focus", folly::dynamic::array());
  REQUIRE(focus);
  CHECK(focus->kind == SearchBarCommand::Focus);
  CHECK(ngn::searchBarCommand("blur", folly::dynamic::array())->kind == SearchBarCommand::Blur);
  CHECK(ngn::searchBarCommand("clearText", folly::dynamic::array())->kind == SearchBarCommand::ClearText);
  CHECK(ngn::searchBarCommand("cancelSearch", folly::dynamic::array())->kind == SearchBarCommand::Cancel);
  auto set = ngn::searchBarCommand("setText", folly::dynamic::array("teal"));
  REQUIRE(set);
  CHECK(set->kind == SearchBarCommand::SetText);
  CHECK(set->text == "teal");
  // setText without a string sets nothing rather than emptying the field.
  CHECK_FALSE(ngn::searchBarCommand("setText", folly::dynamic::array()));
  CHECK_FALSE(ngn::searchBarCommand("setText", folly::dynamic::array(3)));
  // The Cancel button is the field's own on macOS: there is none to toggle.
  CHECK_FALSE(ngn::searchBarCommand("toggleCancelButton", folly::dynamic::array(true)));
  CHECK_FALSE(ngn::searchBarCommand("scroll", folly::dynamic::array()));
}

TEST_CASE("a front header's pieces go where the toolbar puts them, a left item replacing the back button") {
  ngn::HeaderBar bar;
  std::vector<ngn::HeaderSubview> subviews{{9, "right"}, {4, "left"}, {7, "searchBar"}, {5, "right"}, {6, "center"}, {8, "back"}};
  auto layout = ngn::headerLayout(bar, subviews, true);
  CHECK(layout == ngn::HeaderLayout{.back = false, .left = {4}, .center = {6}, .right = {5, 9}, .searchBars = {7}});

  // With no left item, the back button leads while the stack can go back.
  CHECK(ngn::headerLayout(bar, {{5, "right"}}, true).back);
  CHECK_FALSE(ngn::headerLayout(bar, {{5, "right"}}, false).back);
  // hideBackButton, and a left bar button, hide it too.
  bar.hideBackButton = true;
  CHECK_FALSE(ngn::headerLayout(bar, {}, true).back);
  bar.hideBackButton = false;
  bar.left = {ngn::BarButton{.id = "cancel", .title = "Cancel"}};
  CHECK_FALSE(ngn::headerLayout(bar, {}, true).back);
}
