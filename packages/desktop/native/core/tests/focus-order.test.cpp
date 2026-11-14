#include "helpers.h"
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
