#include "ngn/aria-role.h"
#include "ngn/desktop-view-props.h"

#include <doctest/doctest.h>

#include <utility>
#include <vector>

using namespace facebook::react;
using ngn::AriaRole;

namespace {

Props::Shared parse(folly::dynamic raw) {
  static auto context = std::make_shared<const ContextContainer>();
  static ngn::DesktopViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  return descriptor.cloneProps(parserContext, nullptr, RawProps(std::move(raw)));
}

// The role of a view with these props, as a backend reads it.
AriaRole roleOf(folly::dynamic raw) {
  auto props = parse(std::move(raw));
  const auto &view = static_cast<const ViewProps &>(*props);
  return ngn::ariaRole(ngn::roleName(view), ngn::accessibilityInfo(view));
}

AriaRole paragraphRoleOf(folly::dynamic raw, const std::string &text) {
  auto props = parse(std::move(raw));
  const auto &view = static_cast<const ViewProps &>(*props);
  return ngn::ariaRole(ngn::roleName(view), ngn::paragraphAccessibilityInfo(view, text));
}

} // namespace

TEST_CASE("every ARIA role React Native's role prop takes has its ARIA role, or the nearest a toolkit has") {
  const std::vector<std::pair<const char *, AriaRole>> expected{
      {"alert", AriaRole::Alert},
      {"alertdialog", AriaRole::AlertDialog},
      {"application", AriaRole::Group},
      {"article", AriaRole::Article},
      {"banner", AriaRole::Banner},
      {"button", AriaRole::Button},
      {"cell", AriaRole::Cell},
      {"checkbox", AriaRole::Checkbox},
      {"columnheader", AriaRole::ColumnHeader},
      {"combobox", AriaRole::ComboBox},
      {"complementary", AriaRole::Region},
      {"contentinfo", AriaRole::Region},
      {"definition", AriaRole::Generic},
      {"dialog", AriaRole::Dialog},
      {"directory", AriaRole::List},
      {"document", AriaRole::Document},
      {"feed", AriaRole::Feed},
      {"figure", AriaRole::Group},
      {"form", AriaRole::Form},
      {"grid", AriaRole::Grid},
      {"group", AriaRole::Group},
      {"heading", AriaRole::Heading},
      {"img", AriaRole::Img},
      {"link", AriaRole::Link},
      {"list", AriaRole::List},
      {"listitem", AriaRole::ListItem},
      {"log", AriaRole::Log},
      {"main", AriaRole::Main},
      {"marquee", AriaRole::Marquee},
      {"math", AriaRole::Math},
      {"menu", AriaRole::Menu},
      {"menubar", AriaRole::MenuBar},
      {"menuitem", AriaRole::MenuItem},
      {"meter", AriaRole::Meter},
      {"navigation", AriaRole::Navigation},
      {"none", AriaRole::None},
      {"note", AriaRole::Note},
      {"option", AriaRole::Option},
      {"presentation", AriaRole::Presentation},
      {"progressbar", AriaRole::ProgressBar},
      {"radio", AriaRole::Radio},
      {"radiogroup", AriaRole::RadioGroup},
      {"region", AriaRole::Region},
      {"row", AriaRole::Row},
      {"rowgroup", AriaRole::RowGroup},
      {"rowheader", AriaRole::RowHeader},
      {"scrollbar", AriaRole::Scrollbar},
      {"searchbox", AriaRole::SearchBox},
      {"separator", AriaRole::Separator},
      {"slider", AriaRole::Slider},
      {"spinbutton", AriaRole::SpinButton},
      {"status", AriaRole::Status},
      {"summary", AriaRole::Button},
      {"switch", AriaRole::Switch},
      {"tab", AriaRole::Tab},
      {"table", AriaRole::Table},
      {"tablist", AriaRole::TabList},
      {"tabpanel", AriaRole::TabPanel},
      {"term", AriaRole::Label},
      {"timer", AriaRole::Timer},
      {"toolbar", AriaRole::Toolbar},
      {"tooltip", AriaRole::Tooltip},
      {"tree", AriaRole::Tree},
      {"treegrid", AriaRole::TreeGrid},
      {"treeitem", AriaRole::TreeItem},
      // Kept as written by the desktop props: React Native's Role lacks them.
      {"listbox", AriaRole::ListBox},
      {"gridcell", AriaRole::GridCell},
      {"menuitemcheckbox", AriaRole::MenuItemCheckbox},
      {"menuitemradio", AriaRole::MenuItemRadio},
  };
  CHECK(expected.size() == 69);
  for (const auto &[name, role] : expected) {
    CAPTURE(std::string(name));
    CHECK(roleOf(folly::dynamic::object("role", name)) == role);
  }
}

TEST_CASE("every accessibilityRole value has its ARIA role, or the nearest a toolkit has") {
  const std::vector<std::pair<const char *, AriaRole>> expected{
      {"togglebutton", AriaRole::ToggleButton},
      {"search", AriaRole::SearchBox},
      {"image", AriaRole::Img},
      {"text", AriaRole::Label},
      {"adjustable", AriaRole::Slider},
      {"imagebutton", AriaRole::Button},
      {"header", AriaRole::Heading},
      {"tabbar", AriaRole::TabList},
      {"viewgroup", AriaRole::Generic},
      {"keyboardkey", AriaRole::Button},
      {"pager", AriaRole::Group},
      {"scrollview", AriaRole::Generic},
      {"horizontalscrollview", AriaRole::Generic},
      {"webview", AriaRole::Document},
      {"drawerlayout", AriaRole::Group},
      {"slidingdrawer", AriaRole::Group},
      {"iconmenu", AriaRole::Menu},
      // The ones Role has too, by their accessibilityRole spelling.
      {"button", AriaRole::Button},
      {"link", AriaRole::Link},
      {"switch", AriaRole::Switch},
      {"none", AriaRole::None},
  };
  for (const auto &[name, role] : expected) {
    CAPTURE(std::string(name));
    CHECK(roleOf(folly::dynamic::object("accessibilityRole", name)) == role);
  }
}

TEST_CASE("role wins over accessibilityRole, and a view that is no element is read through") {
  CHECK(roleOf(folly::dynamic::object("role", "heading")("accessibilityRole", "button")) == AriaRole::Heading);
  // A layout view, and an element hidden from assistive technology whatever its role.
  CHECK(roleOf(folly::dynamic::object()) == AriaRole::Generic);
  CHECK(roleOf(folly::dynamic::object("role", "button")("accessibilityElementsHidden", true)) == AriaRole::Generic);
  CHECK(roleOf(folly::dynamic::object("role", "button")("importantForAccessibility", "no")) == AriaRole::Generic);
  // An element with no role is a group; one with a role this table does not know is too.
  CHECK(roleOf(folly::dynamic::object("accessible", true)) == AriaRole::Group);
  CHECK(roleOf(folly::dynamic::object("accessibilityLabel", "Card")) == AriaRole::Group);
  CHECK(roleOf(folly::dynamic::object("accessibilityRole", "not-a-role")("accessible", true)) == AriaRole::Group);
}

TEST_CASE("a paragraph is static text while it says something, and takes the role it is given") {
  CHECK(paragraphRoleOf(folly::dynamic::object(), "Hello") == AriaRole::Label);
  CHECK(paragraphRoleOf(folly::dynamic::object(), "") == AriaRole::Generic);
  CHECK(paragraphRoleOf(folly::dynamic::object("role", "heading"), "Inbox") == AriaRole::Heading);
  CHECK(paragraphRoleOf(folly::dynamic::object("accessibilityRole", "link"), "Help") == AriaRole::Link);
  CHECK(paragraphRoleOf(folly::dynamic::object("role", "presentation"), "Hello") == AriaRole::Presentation);
}
