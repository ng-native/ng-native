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
  auto alert = info(folly::dynamic::object("role", "alert")("accessibilityLabel", "Offline"));
  CHECK(alert.role == AxRole::Group);
  CHECK(alert.roleDescription == "alert");
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

TEST_CASE("expanded is reported only when the view says it") {
  CHECK_FALSE(info(folly::dynamic::object("accessible", true)).expanded.has_value());
  CHECK(info(folly::dynamic::object("accessibilityState", folly::dynamic::object("expanded", true))).expanded == true);
  CHECK(info(folly::dynamic::object("accessibilityState", folly::dynamic::object("expanded", false))).expanded == false);
}

namespace {

folly::dynamic actions(std::initializer_list<std::pair<const char *, const char *>> list) {
  auto out = folly::dynamic::array();
  for (auto [name, label] : list) {
    folly::dynamic action = folly::dynamic::object("name", name);
    if (label != nullptr) {
      action["label"] = label;
    }
    out.push_back(action);
  }
  return out;
}

ngn::AxDispatch dispatch(folly::dynamic raw, ngn::AxVerb verb) {
  auto context = std::make_shared<const ContextContainer>();
  ngn::DesktopViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  auto props = descriptor.cloneProps(parserContext, nullptr, RawProps(std::move(raw)));
  return ngn::axDispatch(static_cast<const ViewProps &>(*props), verb);
}

using Kind = ngn::AxDispatch::Kind;

} // namespace

TEST_CASE("declared actions are custom actions by their label, except the ones AppKit has a verb for") {
  auto view = info(folly::dynamic::object("accessibilityActions",
      actions({{"activate", nullptr}, {"archive", "Archive"}, {"increment", nullptr}, {"magicTap", nullptr},
          {"escape", nullptr}, {"decrement", nullptr}, {"longpress", "Show more"}})));
  CHECK(view.customActions == std::vector<ngn::AxAction>{{"archive", "Archive"}, {"magicTap", "magicTap"}, {"longpress", "Show more"}});
  CHECK(view.offersPress);
  CHECK(view.offersIncrement);
  CHECK(view.offersCancel);
}

TEST_CASE("a press is offered on a control or a view that handles one, and steppers on an adjustable") {
  CHECK(info(folly::dynamic::object("accessibilityRole", "button")).offersPress);
  CHECK(info(folly::dynamic::object("role", "link")).offersPress);
  CHECK(info(folly::dynamic::object("role", "checkbox")).offersPress);
  CHECK(info(folly::dynamic::object("onAccessibilityTap", true)).offersPress);
  CHECK_FALSE(info(folly::dynamic::object("accessible", true)).offersPress);
  CHECK_FALSE(info(folly::dynamic::object("role", "heading")).offersPress);
  CHECK(info(folly::dynamic::object("role", "slider")).offersIncrement);
  CHECK(info(folly::dynamic::object("accessibilityRole", "adjustable")).offersIncrement);
  CHECK_FALSE(info(folly::dynamic::object("role", "button")).offersIncrement);
  CHECK(info(folly::dynamic::object("onAccessibilityEscape", true)).offersCancel);
  CHECK_FALSE(info(folly::dynamic::object("accessible", true)).offersCancel);
}

TEST_CASE("a press is the accessibility tap, then a declared activate, then a click, as iOS has them") {
  CHECK(dispatch(folly::dynamic::object("onAccessibilityTap", true)("onAccessibilityAction", true)(
                     "accessibilityActions", actions({{"activate", nullptr}})),
            ngn::AxVerb::Press)
            .kind == Kind::Tap);
  auto activate = dispatch(
      folly::dynamic::object("onAccessibilityAction", true)("accessibilityActions", actions({{"activate", nullptr}})),
      ngn::AxVerb::Press);
  CHECK(activate.kind == Kind::Action);
  CHECK(activate.action == "activate");
  // Declared with nothing listening, or not declared: a click, which reaches a press handler.
  CHECK(dispatch(folly::dynamic::object("accessibilityActions", actions({{"activate", nullptr}})), ngn::AxVerb::Press).kind ==
      Kind::Click);
  CHECK(dispatch(folly::dynamic::object("role", "button"), ngn::AxVerb::Press).kind == Kind::Click);
}

TEST_CASE("the steppers and cancel reach the view only when it listens") {
  auto up = dispatch(folly::dynamic::object("onAccessibilityAction", true), ngn::AxVerb::Increment);
  CHECK(up.kind == Kind::Action);
  CHECK(up.action == "increment");
  CHECK(dispatch(folly::dynamic::object("onAccessibilityAction", true), ngn::AxVerb::Decrement).action == "decrement");
  CHECK(dispatch(folly::dynamic::object("role", "slider"), ngn::AxVerb::Increment).kind == Kind::None);
  CHECK(dispatch(folly::dynamic::object("onAccessibilityEscape", true), ngn::AxVerb::Cancel).kind == Kind::Escape);
  auto escape = dispatch(
      folly::dynamic::object("onAccessibilityAction", true)("accessibilityActions", actions({{"escape", nullptr}})),
      ngn::AxVerb::Cancel);
  CHECK(escape.kind == Kind::Action);
  CHECK(escape.action == "escape");
  CHECK(dispatch(folly::dynamic::object("accessible", true), ngn::AxVerb::Cancel).kind == Kind::None);
}

TEST_CASE("a heading is the heading role, with its level, and still says what it is for an older AppKit") {
  auto heading = info(folly::dynamic::object("role", "heading")("accessibilityLevel", 2));
  CHECK(heading.role == AxRole::Heading);
  CHECK(heading.roleDescription == "heading");
  CHECK(heading.level == 2);
  CHECK(info(folly::dynamic::object("accessibilityRole", "header")).role == AxRole::Heading);
  CHECK_FALSE(info(folly::dynamic::object("accessibilityRole", "header")).level.has_value());
}

TEST_CASE("every role the components take is mapped") {
  // Each of view-base.ts's Role and AccessibilityRole names: an AppKit role, or a group that says
  // what it is. Only `none`, `presentation` and a plain `group` or view are a group with no words.
  const char *named[] = {"alert", "alertdialog", "application", "article", "banner", "button", "cell", "checkbox",
      "columnheader", "combobox", "complementary", "contentinfo", "definition", "dialog", "directory", "document",
      "drawerlayout", "feed", "figure", "form", "grid", "header", "heading", "horizontalscrollview", "iconmenu", "image",
      "imagebutton", "img", "keyboardkey", "link", "list", "listitem", "log", "main", "marquee", "math", "menu",
      "menubar", "menuitem", "meter", "navigation", "note", "option", "pager", "progressbar", "radio", "radiogroup",
      "region", "row", "rowgroup", "rowheader", "scrollbar", "scrollview", "search", "searchbox", "separator",
      "slidingdrawer", "slider", "spinbutton", "status", "summary", "switch", "tab", "tabbar", "table", "tablist",
      "tabpanel", "term", "text", "timer", "togglebutton", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
      "adjustable", "webview"};
  for (const char *name : named) {
    auto mapped = info(folly::dynamic::object("accessibilityRole", name));
    CAPTURE(name);
    CHECK((mapped.role != AxRole::Group || !mapped.roleDescription.empty()));
  }
  CHECK(info(folly::dynamic::object("role", "group")).role == AxRole::Group);
  CHECK(info(folly::dynamic::object("accessibilityRole", "viewgroup")).role == AxRole::Group);
  CHECK(info(folly::dynamic::object("role", "meter")).role == AxRole::LevelIndicator);
  CHECK(info(folly::dynamic::object("role", "tree")).role == AxRole::Outline);
  auto item = info(folly::dynamic::object("role", "treeitem"));
  CHECK(item.role == AxRole::Row);
  CHECK(item.subrole == AxSubrole::OutlineRow);
  CHECK(info(folly::dynamic::object("accessibilityRole", "scrollview")).role == AxRole::ScrollArea);
}

TEST_CASE("a paragraph is static text whose value is its string, and no element when it says nothing") {
  auto context = std::make_shared<const ContextContainer>();
  ngn::DesktopViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  auto paragraph = [&](folly::dynamic raw, std::string text) {
    auto props = descriptor.cloneProps(parserContext, nullptr, RawProps(std::move(raw)));
    return ngn::paragraphAccessibilityInfo(static_cast<const ViewProps &>(*props), text);
  };
  auto text = paragraph(folly::dynamic::object("accessible", true), "Hello");
  CHECK(text.element);
  CHECK(text.role == AxRole::StaticText);
  CHECK(text.value == "Hello");
  CHECK(text.label.empty());
  CHECK(text.hidesChildren);
  // A label speaks for it; a role it names wins; empty or hidden text is no element.
  CHECK(paragraph(folly::dynamic::object("accessibilityLabel", "Greeting"), "Hi").label == "Greeting");
  CHECK(paragraph(folly::dynamic::object("role", "heading"), "Inbox").role == AxRole::Heading);
  CHECK(paragraph(folly::dynamic::object("role", "heading"), "Inbox").value == "Inbox");
  CHECK(paragraph(folly::dynamic::object("role", "heading"), "Inbox").label == "Inbox");
  CHECK_FALSE(paragraph(folly::dynamic::object(), "").element);
  CHECK_FALSE(paragraph(folly::dynamic::object("accessibilityElementsHidden", true), "Hi").element);
}

TEST_CASE("a control's text is read as the control, while a container's children stay elements") {
  CHECK(info(folly::dynamic::object("role", "button")("accessibilityLabel", "Mail")).hidesChildren);
  CHECK(info(folly::dynamic::object("role", "heading")).hidesChildren);
  CHECK(info(folly::dynamic::object("accessible", true)).hidesChildren);
  CHECK_FALSE(info(folly::dynamic::object("role", "list")("accessibilityLabel", "Inbox")).hidesChildren);
  CHECK_FALSE(info(folly::dynamic::object("role", "navigation")("accessibilityLabel", "Primary")).hidesChildren);
  CHECK_FALSE(info(folly::dynamic::object("accessibilityLabel", "Settings")).hidesChildren);
  CHECK_FALSE(info(folly::dynamic::object()).hidesChildren);
}
