#include "ngn/accessibility.h"
#include "ngn/desktop-view-props.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::AxRole;
using ngn::AxSubrole;

namespace {

ngn::AxInfo info(folly::dynamic raw) {
  auto context = std::make_shared<const ContextContainer>();
  ngn::DesktopViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  auto props = descriptor.cloneProps(parserContext, nullptr, RawProps(std::move(raw)));
  return ngn::accessibilityInfo(static_cast<const ViewProps &>(*props));
}

} // namespace

TEST_CASE("a button is a button with its label, hint and state") {
  auto button = info(folly::dynamic::object("accessible", true)("accessibilityRole", "button")("accessibilityLabel", "Save")(
      "accessibilityHint", "Saves the file")("accessibilityState", folly::dynamic::object("disabled", true)));
  CHECK(button.element);
  CHECK(button.role == AxRole::Button);
  CHECK(button.label == "Save");
  CHECK(button.hint == "Saves the file");
  CHECK(button.disabled);
  CHECK_FALSE(button.checked.has_value());
}

TEST_CASE("role wins over accessibilityRole, as React Native reads them") {
  auto link = info(folly::dynamic::object("role", "link")("accessibilityRole", "button"));
  CHECK(link.role == AxRole::Link);
  CHECK(link.element);
}

TEST_CASE("a switch is a checkbox with the switch subrole, and says whether it is on") {
  auto toggle = info(folly::dynamic::object("accessibilityRole", "switch")("accessibilityState", folly::dynamic::object("checked", true)));
  CHECK(toggle.role == AxRole::CheckBox);
  CHECK(toggle.subrole == AxSubrole::Switch);
  CHECK(toggle.checked == 1);
  CHECK(info(folly::dynamic::object("role", "checkbox")("accessibilityState", folly::dynamic::object("checked", "mixed"))).checked == 2);
}

TEST_CASE("a role AppKit lacks is a group that says what it is") {
  auto heading = info(folly::dynamic::object("role", "heading")("accessibilityLabel", "Inbox"));
  CHECK(heading.role == AxRole::Group);
  CHECK(heading.roleDescription == "heading");
  CHECK(info(folly::dynamic::object("accessibilityRole", "header")).roleDescription == "heading");
  CHECK(info(folly::dynamic::object("role", "tab")).subrole == AxSubrole::Tab);
  CHECK(info(folly::dynamic::object("role", "searchbox")).subrole == AxSubrole::SearchField);
}

TEST_CASE("a plain view is no element, and hidden or presentational ones never are") {
  CHECK_FALSE(info(folly::dynamic::object()).element);
  CHECK(info(folly::dynamic::object("accessible", true)).element);
  CHECK(info(folly::dynamic::object("accessibilityLabel", "Logo")).element);
  CHECK_FALSE(info(folly::dynamic::object("accessibilityRole", "button")("accessibilityElementsHidden", true)).element);
  CHECK_FALSE(info(folly::dynamic::object("role", "presentation")("accessible", true)).element);
  CHECK_FALSE(
      info(folly::dynamic::object("accessible", true)("importantForAccessibility", "no-hide-descendants")).element);
}

TEST_CASE("a value is the text, or else the number now") {
  CHECK(info(folly::dynamic::object("accessibilityValue", folly::dynamic::object("text", "half"))).value == "half");
  CHECK(info(folly::dynamic::object("accessibilityValue", folly::dynamic::object("now", 40)("min", 0)("max", 100))).value == "40");
}
