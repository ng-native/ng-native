#include "helpers.h"
#include "ngn/accessibility.h"
#include "ngn/desktop-view-props.h"
#include "ngn/focus-order.h"
#include "ngn/native-controls.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::TabReach;
using ngn::testing::shadowView;

namespace {

Props::Shared view(folly::dynamic raw) {
  static auto context = std::make_shared<const ContextContainer>();
  static ngn::DesktopViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  return descriptor.cloneProps(parserContext, nullptr, RawProps(std::move(raw)));
}

Props::Shared button(folly::dynamic raw) {
  static auto context = std::make_shared<const ContextContainer>();
  static ngn::NativeButtonComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  return descriptor.cloneProps(parserContext, nullptr, RawProps(std::move(raw)));
}

struct Tree {
  ngn::ViewTree tree;
  Tree() {
    add(1, -1, "View", view(folly::dynamic::object()));
  }
  void add(Tag tag, Tag parent, const char *name, Props::Shared props) {
    tree.create(shadowView(tag, name, {{0, 0}, {10, 10}}, std::move(props)));
    if (parent != -1) {
      tree.insert(parent, tag, static_cast<int>(tree.find(parent)->children.size()));
    }
  }
  std::vector<Tag> order(TabReach reach = TabReach::All, Tag root = 1) const {
    return ngn::tabOrder(tree, root, reach);
  }
};

using Tags = std::vector<Tag>;

} // namespace

TEST_CASE("Tab visits focusable views, text inputs and native controls in tree order") {
  Tree t;
  t.add(2, 1, "View", view(folly::dynamic::object("focusable", true)));
  t.add(3, 1, "View", view(folly::dynamic::object()));
  t.add(4, 3, "TextInput", std::make_shared<const ViewProps>());
  t.add(5, 3, "NgNativeButton", button(folly::dynamic::object("title", "Go")));
  t.add(6, 1, "ActivityIndicatorView", button(folly::dynamic::object()));
  t.add(7, 1, "View", view(folly::dynamic::object("tabIndex", 0)));
  CHECK(t.order() == Tags{2, 4, 5, 7});
}

TEST_CASE("positive tabIndex comes first, lowest first, and a negative one leaves the view out") {
  Tree t;
  t.add(2, 1, "View", view(folly::dynamic::object("focusable", true)));
  t.add(3, 1, "View", view(folly::dynamic::object("tabIndex", 2)));
  t.add(4, 1, "View", view(folly::dynamic::object("tabIndex", 1)));
  t.add(5, 1, "NgNativeButton", button(folly::dynamic::object("tabIndex", -1)));
  t.add(6, 1, "View", view(folly::dynamic::object("tabIndex", 2)));
  t.add(7, 1, "NgNativeButton", button(folly::dynamic::object("focusable", false)));
  t.add(8, 1, "View", view(folly::dynamic::object("focusable", true)("tabIndex", -1)));
  CHECK(t.order() == Tags{4, 3, 6, 2});
}

TEST_CASE("with the Mac's default keyboard navigation, Tab reaches only text inputs") {
  Tree t;
  t.add(2, 1, "View", view(folly::dynamic::object("focusable", true)));
  t.add(3, 1, "TextInput", std::make_shared<const ViewProps>());
  t.add(4, 1, "NgNativeButton", button(folly::dynamic::object()));
  t.add(5, 1, "TextInput", std::make_shared<const ViewProps>());
  CHECK(t.order(TabReach::TextInputs) == Tags{3, 5});
}

TEST_CASE("covered screens, hidden views and other containers' content are skipped") {
  Tree t;
  t.add(2, 1, "View", view(folly::dynamic::object()));
  t.add(3, 2, "TextInput", std::make_shared<const ViewProps>());
  t.add(4, 1, "View", view(folly::dynamic::object()));
  t.add(5, 4, "TextInput", std::make_shared<const ViewProps>());
  t.add(6, 1, "View", view(folly::dynamic::object()));
  t.add(7, 6, "TextInput", std::make_shared<const ViewProps>());
  t.add(8, 1, "TextInput", std::make_shared<const ViewProps>());
  t.tree.setCovered(2, true);
  t.tree.addContainerRoot(4);
  auto hidden = t.tree.find(6)->view;
  hidden.layoutMetrics.displayType = DisplayType::None;
  t.tree.update(hidden);
  CHECK(t.order() == Tags{8});
  // Inside the popover, only its own.
  CHECK(t.order(TabReach::All, 4) == Tags{5});
}

TEST_CASE("Tab and Shift-Tab move round the order and wrap") {
  Tree t;
  t.add(2, 1, "TextInput", std::make_shared<const ViewProps>());
  t.add(3, 1, "TextInput", std::make_shared<const ViewProps>());
  t.add(4, 1, "TextInput", std::make_shared<const ViewProps>());
  auto next = [&](std::optional<Tag> from, bool backwards) {
    return ngn::nextInTabOrder(t.tree, 1, from, backwards, TabReach::All);
  };
  CHECK(next(std::nullopt, false) == 2);
  CHECK(next(std::nullopt, true) == 4);
  CHECK(next(2, false) == 3);
  CHECK(next(4, false) == 2);
  CHECK(next(2, true) == 4);
  CHECK(next(3, true) == 2);
  // Focus on something Tab does not visit starts again from the ends.
  CHECK(next(1, false) == 2);

  Tree empty;
  CHECK_FALSE(ngn::nextInTabOrder(empty.tree, 1, std::nullopt, false, TabReach::All).has_value());
}

TEST_CASE("a rotor lists its views in tree order, skipping what is not drawn and what an element hides") {
  using ngn::AxRotor;
  auto heading = [](const char *label) {
    return view(folly::dynamic::object("accessibilityRole", "header")("accessibilityLabel", label));
  };
  Tree t;
  t.add(2, 1, "View", heading("Title"));
  t.add(3, 1, "View", view(folly::dynamic::object("role", "link")("accessibilityLabel", "More")));
  t.add(4, 1, "View", view(folly::dynamic::object("role", "main")));
  t.add(5, 4, "View", heading("Inside main"));
  // An element that hides its children: listed, and what is under it is not.
  t.add(6, 1, "View", view(folly::dynamic::object("accessible", true)("role", "link")("accessibilityLabel", "Card")));
  t.add(7, 6, "View", heading("In the card"));
  // Not drawn: a covered screen, a view with display none, another container's root.
  t.add(8, 1, "View", view(folly::dynamic::object()));
  t.add(9, 8, "View", heading("Covered"));
  t.add(10, 1, "View", view(folly::dynamic::object()));
  t.add(11, 10, "View", heading("Display none"));
  t.add(12, 1, "View", view(folly::dynamic::object()));
  t.add(13, 12, "View", heading("Popover"));
  t.add(14, 1, "View", heading("Last"));
  t.tree.setCovered(8, true);
  auto hidden = t.tree.find(10)->view;
  hidden.layoutMetrics.displayType = DisplayType::None;
  t.tree.update(hidden);
  t.tree.addContainerRoot(12);

  CHECK(ngn::rotorItems(t.tree, 1, AxRotor::Headings) == Tags{2, 5, 14});
  CHECK(ngn::rotorItems(t.tree, 1, AxRotor::Links) == Tags{3, 6});
  CHECK(ngn::rotorItems(t.tree, 1, AxRotor::Landmarks) == Tags{4});
  // The popover's own rotor holds its own.
  CHECK(ngn::rotorItems(t.tree, 12, AxRotor::Headings) == Tags{13});
  CHECK(ngn::rotorItems(t.tree, 99, AxRotor::Headings).empty());
}

namespace {

folly::dynamic withRole(const char *role) {
  return folly::dynamic::object("role", role);
}

// An item with a roving tabIndex: 0 for the one in Tab order, -1 for the rest.
Props::Shared item(const char *role, int tabIndex, folly::dynamic state = folly::dynamic::object()) {
  return view(folly::dynamic::object("role", role)("tabIndex", tabIndex)("accessibilityState", std::move(state)));
}

std::optional<Tag> move(const Tree &t, Tag focused, ngn::CompositeKey key, bool control = false) {
  return ngn::compositeMove(t.tree, 1, focused, key, control);
}

using Key = ngn::CompositeKey;

} // namespace

TEST_CASE("arrows move round a tablist and a radiogroup, wrapping, and Home and End go to the ends") {
  Tree t;
  t.add(2, 1, "View", view(withRole("tablist")));
  t.add(3, 2, "View", item("tab", 0));
  t.add(4, 2, "View", item("tab", -1));
  t.add(5, 2, "View", item("tab", -1));
  CHECK(move(t, 3, Key::Right) == 4);
  CHECK(move(t, 4, Key::Down) == 5);
  CHECK(move(t, 5, Key::Right) == 3);
  CHECK(move(t, 3, Key::Left) == 5);
  CHECK(move(t, 4, Key::Up) == 3);
  CHECK(move(t, 4, Key::Home) == 3);
  CHECK(move(t, 3, Key::End) == 5);

  t.add(6, 1, "View", view(withRole("radiogroup")));
  t.add(7, 6, "View", item("radio", 0));
  t.add(8, 6, "View", item("radio", -1, folly::dynamic::object("disabled", true)));
  t.add(9, 6, "View", item("radio", -1));
  // A disabled radio is skipped.
  CHECK(move(t, 7, Key::Down) == 9);
  CHECK(move(t, 9, Key::Right) == 7);
  CHECK(move(t, 7, Key::Up) == 9);
}

TEST_CASE("a menu takes Up and Down and wraps, a menubar Left and Right, a listbox stops at its ends") {
  Tree t;
  t.add(2, 1, "View", view(withRole("menu")));
  t.add(3, 2, "View", item("menuitem", -1));
  t.add(4, 2, "View", item("menuitemcheckbox", -1));
  t.add(5, 2, "View", item("menuitemradio", -1));
  CHECK(move(t, 3, Key::Down) == 4);
  CHECK(move(t, 5, Key::Down) == 3);
  CHECK(move(t, 3, Key::Up) == 5);
  CHECK_FALSE(move(t, 3, Key::Right).has_value());

  t.add(6, 1, "View", view(withRole("menubar")));
  t.add(7, 6, "View", item("menuitem", 0));
  t.add(8, 6, "View", item("menuitem", -1));
  CHECK(move(t, 7, Key::Right) == 8);
  CHECK(move(t, 8, Key::Right) == 7);
  CHECK_FALSE(move(t, 7, Key::Down).has_value());

  t.add(10, 1, "View", view(withRole("listbox")));
  t.add(11, 10, "View", item("option", 0));
  t.add(12, 10, "View", item("option", -1));
  t.add(13, 10, "View", item("option", -1));
  CHECK(move(t, 11, Key::Down) == 12);
  CHECK(move(t, 12, Key::Up) == 11);
  // At either end the key is used and the focus stays.
  CHECK(move(t, 13, Key::Down) == 13);
  CHECK(move(t, 11, Key::Up) == 11);
  CHECK(move(t, 12, Key::End) == 13);
  CHECK(move(t, 12, Key::Home) == 11);
  CHECK_FALSE(move(t, 11, Key::Left).has_value());
}

TEST_CASE("a grid moves by row and column, stops at its edges, and Control-Home and -End go to its corners") {
  Tree t;
  t.add(2, 1, "View", view(withRole("grid")));
  // Three rows: the middle one shorter, its row inside a rowgroup.
  t.add(3, 2, "View", view(withRole("row")));
  t.add(4, 3, "View", item("columnheader", -1));
  t.add(5, 3, "View", item("columnheader", -1));
  t.add(6, 3, "View", item("columnheader", -1));
  t.add(7, 2, "View", view(withRole("rowgroup")));
  t.add(8, 7, "View", view(withRole("row")));
  t.add(9, 8, "View", item("rowheader", 0));
  t.add(10, 8, "View", item("gridcell", -1));
  t.add(11, 7, "View", view(withRole("row")));
  t.add(12, 11, "View", item("gridcell", -1));
  t.add(13, 11, "View", item("cell", -1));
  t.add(14, 11, "View", item("gridcell", -1));
  CHECK(move(t, 9, Key::Right) == 10);
  CHECK(move(t, 10, Key::Right) == 10);
  CHECK(move(t, 9, Key::Left) == 9);
  CHECK(move(t, 9, Key::Up) == 4);
  CHECK(move(t, 4, Key::Up) == 4);
  CHECK(move(t, 10, Key::Down) == 13);
  // Down from a column the next row lacks: that row's last cell.
  CHECK(move(t, 6, Key::Down) == 10);
  CHECK(move(t, 14, Key::Down) == 14);
  CHECK(move(t, 13, Key::Home) == 12);
  CHECK(move(t, 12, Key::End) == 14);
  CHECK(move(t, 13, Key::Home, true) == 4);
  CHECK(move(t, 9, Key::End, true) == 14);
}

TEST_CASE("an item that takes no focus gives it to the first view inside it, and the focus may be inside an item") {
  Tree t;
  t.add(2, 1, "View", view(withRole("grid")));
  t.add(3, 2, "View", view(withRole("row")));
  t.add(4, 3, "View", view(withRole("gridcell")));
  t.add(5, 4, "NgNativeButton", button(folly::dynamic::object("title", "Edit")));
  t.add(6, 3, "View", view(withRole("gridcell")));
  t.add(7, 6, "View", view(folly::dynamic::object("focusable", true)));
  // A cell with nothing to focus is passed over.
  t.add(8, 3, "View", view(withRole("gridcell")));
  t.add(9, 3, "View", item("gridcell", -1));
  CHECK(move(t, 7, Key::Left) == 5);
  CHECK(move(t, 7, Key::Right) == 9);
  CHECK(move(t, 9, Key::Left) == 7);
  // A native control uses its own keys: nothing moves from one.
  CHECK_FALSE(move(t, 5, Key::Right).has_value());
}

TEST_CASE("right to left, Left and Right swap in a tablist and a grid") {
  Tree t;
  t.add(2, 1, "View", view(withRole("tablist")));
  t.add(3, 2, "View", item("tab", 0));
  t.add(4, 2, "View", item("tab", -1));
  auto rtl = t.tree.find(2)->view;
  rtl.layoutMetrics.layoutDirection = LayoutDirection::RightToLeft;
  t.tree.update(rtl);
  CHECK(move(t, 3, Key::Left) == 4);
  CHECK(move(t, 4, Key::Right) == 3);
  // Up and Down are not sides.
  CHECK(move(t, 3, Key::Down) == 4);

  t.add(5, 1, "View", view(withRole("grid")));
  t.add(6, 5, "View", view(withRole("row")));
  t.add(7, 6, "View", item("gridcell", 0));
  t.add(8, 6, "View", item("gridcell", -1));
  auto grid = t.tree.find(5)->view;
  grid.layoutMetrics.layoutDirection = LayoutDirection::RightToLeft;
  t.tree.update(grid);
  CHECK(move(t, 7, Key::Left) == 8);
  CHECK(move(t, 8, Key::Left) == 8);
  CHECK(move(t, 8, Key::Right) == 7);
}

TEST_CASE("arrows do nothing outside a composite, in a text input, across a nested composite or into another container") {
  Tree t;
  t.add(2, 1, "View", view(folly::dynamic::object("focusable", true)));
  CHECK_FALSE(move(t, 2, Key::Down).has_value());

  t.add(3, 1, "View", view(withRole("listbox")));
  t.add(4, 3, "View", item("option", 0));
  t.add(5, 3, "TextInput", std::make_shared<const ViewProps>());
  // A nested composite's items are its own.
  t.add(6, 3, "View", view(withRole("menu")));
  t.add(7, 6, "View", item("option", -1));
  t.add(8, 6, "View", item("menuitem", -1));
  // Hidden, and another container's root.
  t.add(9, 3, "View", item("option", -1));
  t.add(10, 3, "View", item("option", -1));
  t.add(11, 3, "View", item("option", -1));
  auto hidden = t.tree.find(9)->view;
  hidden.layoutMetrics.displayType = DisplayType::None;
  t.tree.update(hidden);
  t.tree.addContainerRoot(10);
  CHECK_FALSE(move(t, 5, Key::Down).has_value());
  CHECK(move(t, 4, Key::Down) == 11);
  CHECK(move(t, 8, Key::Down) == 8);
  CHECK(move(t, 11, Key::Home) == 4);
}

TEST_CASE("a composite is one Tab stop: the focused item, else the selected or checked one, else the first") {
  Tree t;
  t.add(2, 1, "TextInput", std::make_shared<const ViewProps>());
  t.add(3, 1, "View", view(withRole("tablist")));
  // Every tab in Tab order, the second selected.
  t.add(4, 3, "View", item("tab", 0));
  t.add(5, 3, "View", item("tab", 0, folly::dynamic::object("selected", true)));
  t.add(6, 3, "View", item("tab", 0));
  t.add(7, 1, "View", view(withRole("radiogroup")));
  t.add(8, 7, "View", item("radio", 0));
  t.add(9, 7, "View", item("radio", 0, folly::dynamic::object("checked", true)));
  t.add(10, 1, "View", view(withRole("listbox")));
  t.add(11, 10, "View", item("option", 0));
  t.add(12, 10, "View", item("option", 0));
  // A text input inside a composite keeps its own stop.
  t.add(13, 10, "TextInput", std::make_shared<const ViewProps>());
  t.add(14, 1, "View", view(folly::dynamic::object("focusable", true)));
  CHECK(t.order() == Tags{2, 5, 9, 11, 13, 14});
  // With the focus on an item, that item is the stop, though its tabIndex is -1.
  t.add(15, 10, "View", item("option", -1));
  CHECK(ngn::tabOrder(t.tree, 1, TabReach::All, 15) == Tags{2, 5, 9, 15, 13, 14});
  CHECK(ngn::nextInTabOrder(t.tree, 1, 15, false, TabReach::All) == 13);
  CHECK(ngn::nextInTabOrder(t.tree, 1, 15, true, TabReach::All) == 9);
  CHECK(ngn::nextInTabOrder(t.tree, 1, 6, false, TabReach::All) == 9);
  // Only text inputs: the composites are passed over.
  CHECK(t.order(TabReach::TextInputs) == Tags{2, 13});
}

TEST_CASE("a focused composite item that is no longer drawn is not the composite's stop") {
  Tree t;
  t.add(2, 1, "View", view(withRole("tablist")));
  t.add(3, 2, "View", item("tab", 0));
  t.add(4, 2, "View", view(folly::dynamic::object()));
  t.add(5, 4, "View", item("tab", -1));
  t.add(6, 1, "TextInput", std::make_shared<const ViewProps>());
  CHECK(ngn::tabOrder(t.tree, 1, TabReach::All, 5) == Tags{5, 6});
  // The focused tab's wrapper is hidden: the stop is the first drawn tab.
  auto hidden = t.tree.find(4)->view;
  hidden.layoutMetrics.displayType = DisplayType::None;
  t.tree.update(hidden);
  CHECK(ngn::tabOrder(t.tree, 1, TabReach::All, 5) == Tags{3, 6});
  // Covered, or another container's content, the same.
  hidden.layoutMetrics.displayType = DisplayType::Flex;
  t.tree.update(hidden);
  t.tree.setCovered(4, true);
  CHECK(ngn::tabOrder(t.tree, 1, TabReach::All, 5) == Tags{3, 6});
  t.tree.setCovered(4, false);
  t.tree.addContainerRoot(4);
  CHECK(ngn::tabOrder(t.tree, 1, TabReach::All, 5) == Tags{3, 6});
}

TEST_CASE("a focusable composite is one Tab stop with its items, and its own when it has none") {
  Tree t;
  t.add(2, 1, "View", view(folly::dynamic::object("role", "tablist")("focusable", true)));
  t.add(3, 2, "View", item("tab", 0));
  t.add(4, 2, "View", item("tab", -1));
  t.add(5, 1, "View", view(folly::dynamic::object("role", "radiogroup")("focusable", true)));
  t.add(6, 1, "TextInput", std::make_shared<const ViewProps>());
  CHECK(t.order() == Tags{3, 5, 6});
}

TEST_CASE("a composite's stop is the item that is checked, though the view taking the focus is inside it") {
  Tree t;
  t.add(2, 1, "View", view(withRole("radiogroup")));
  // Radio wrappers holding the state, each with a focusable view inside.
  t.add(3, 2, "View", view(withRole("radio")));
  t.add(4, 3, "View", view(folly::dynamic::object("focusable", true)));
  t.add(5, 2, "View", view(folly::dynamic::object("role", "radio")("accessibilityState", folly::dynamic::object("checked", true))));
  t.add(6, 5, "View", view(folly::dynamic::object("focusable", true)));
  CHECK(t.order() == Tags{6});
}

TEST_CASE("a plain view takes the focus with focusable or any tabIndex, in the container it is in") {
  ngn::DesktopProps props;
  CHECK_FALSE(ngn::viewTakesFocus(props));
  props.focusable = true;
  CHECK(ngn::viewTakesFocus(props));
  props.focusable = false;
  CHECK_FALSE(ngn::viewTakesFocus(props));
  props.tabIndex = -1;
  CHECK(ngn::viewTakesFocus(props));

  ngn::ViewTree tree;
  for (Tag tag : {1, 2, 3, 4}) {
    ShadowView view;
    view.tag = tag;
    tree.create(view);
  }
  tree.insert(1, 2, 0);
  tree.insert(2, 3, 0);
  tree.insert(3, 4, 0);
  CHECK(ngn::focusContainer(tree, 4) == 1);
  tree.addContainerRoot(2);
  CHECK(ngn::focusContainer(tree, 4) == 2);
  CHECK(ngn::focusContainer(tree, 2) == 2);
  CHECK(ngn::focusContainer(tree, 1) == 1);
  tree.removeContainerRoot(2);
  CHECK(ngn::focusContainer(tree, 4) == 1);
  // A view no longer in the tree is its own.
  CHECK(ngn::focusContainer(tree, 9) == 9);
}
