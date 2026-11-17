// Tab and Shift-Tab over mounted views (tab-walk.h): the focus moves through the views in the order
// the core computes (focus-order.h), past the views it leaves out (display: none, a negative
// tabIndex) and the ones AppKit will not focus (a disabled control).
#include "mounted-views.h"

#import "../../tab-walk.h"

#include <doctest/doctest.h>

#include <sstream>

// Tags as the failure message prints them.
namespace doctest {
template <>
struct StringMaker<std::vector<facebook::react::Tag>> {
  static String convert(const std::vector<facebook::react::Tag> &tags) {
    std::ostringstream out;
    out << "{";
    for (size_t i = 0; i < tags.size(); i++) {
      out << (i ? ", " : "") << tags[i];
    }
    out << "}";
    return out.str().c_str();
  }
};
} // namespace doctest

using namespace facebook::react;
using ngn::TabReach;
using ngn::testing::datePickerProps;
using ngn::testing::MountedViews;
using ngn::testing::textInputProps;
using ngn::testing::viewProps;

namespace {

using Tags = std::vector<Tag>;

// The view holding the focus, as Tab finds it: a text field's field editor stands in for its view.
std::optional<Tag> focusedTag(NSWindow *window) {
  NGNView *focused = ngn::appkit::focusContext(window).focused;
  return focused != nil ? std::optional<Tag>(static_cast<Tag>(focused.reactTag)) : std::nullopt;
}

// Presses Tab (Shift-Tab with `backwards`) `times` times from where the focus is, and answers where
// it went each time.
Tags walk(MountedViews &m, size_t times, bool backwards = false, TabReach reach = TabReach::All) {
  Tags visited;
  for (size_t i = 0; i < times; i++) {
    REQUIRE(ngn::appkit::moveFocus(m.window, m.mounting->tree(), *m.backend, backwards, reach));
    auto tag = focusedTag(m.window);
    REQUIRE(tag.has_value());
    visited.push_back(*tag);
  }
  return visited;
}

// Text inputs, a focusable view, date pickers (one disabled), views with a positive and a negative
// tabIndex, and a subtree with display: none.
struct Form {
  MountedViews m;
  ShadowView disabledPicker = MountedViews::shadow(4, "RNDateTimePicker", datePickerProps(folly::dynamic::object("enabled", false)), 90);
  ShadowView card = MountedViews::shadow(3, "View", viewProps(folly::dynamic::object("focusable", true)), 60);

  Form() {
    m.add(MountedViews::shadow(2, "TextInput", textInputProps(folly::dynamic::object()), 30));
    m.add(card);
    m.add(disabledPicker);
    auto hidden = MountedViews::shadow(5, "View", viewProps(folly::dynamic::object()), 120);
    hidden.layoutMetrics.displayType = DisplayType::None;
    m.add(hidden);
    m.add(MountedViews::shadow(6, "TextInput", textInputProps(folly::dynamic::object()), 0), 5);
    m.add(MountedViews::shadow(7, "RNDateTimePicker", datePickerProps(folly::dynamic::object()), 150));
    m.add(MountedViews::shadow(8, "View", viewProps(folly::dynamic::object("tabIndex", 1)), 180));
    m.add(MountedViews::shadow(9, "View", viewProps(folly::dynamic::object("tabIndex", -1)), 210));
    m.add(MountedViews::shadow(10, "TextInput", textInputProps(folly::dynamic::object()), 240));
    [m.window makeFirstResponder:nil];
  }
};

} // namespace

TEST_CASE("Tab walks the mounted views in the core's order, past a disabled control, and wraps round") {
  Form f;
  // The core's order: the positive tabIndex first, then tree order, nothing under display: none.
  REQUIRE(ngn::tabOrder(f.m.mounting->tree(), MountedViews::kSurface, TabReach::All) == Tags{8, 2, 3, 4, 7, 10});
  // AppKit will not focus the disabled picker, so Tab passes it on.
  CHECK(walk(f.m, 2) == Tags{8, 2});
  // A text field's focus is its field editor's, inside the field.
  CHECK([f.m.window.firstResponder isKindOfClass:NSTextView.class]);
  CHECK(walk(f.m, 4) == Tags{3, 7, 10, 8});
}

TEST_CASE("Shift-Tab walks the same views backwards") {
  Form f;
  CHECK(walk(f.m, 6, true) == Tags{10, 7, 3, 2, 8, 10});
}

TEST_CASE("with keyboard navigation off, Tab reaches only the text inputs") {
  Form f;
  CHECK(walk(f.m, 3, false, TabReach::TextInputs) == Tags{2, 10, 2});
  CHECK(walk(f.m, 2, true, TabReach::TextInputs) == Tags{10, 2});
}

TEST_CASE("a control enabled, or a view hidden, by a later commit joins or leaves the walk") {
  Form f;
  f.m.update(f.disabledPicker, datePickerProps(folly::dynamic::object("enabled", true)));
  CHECK(walk(f.m, 6) == Tags{8, 2, 3, 4, 7, 10});

  auto hiddenCard = f.card;
  hiddenCard.layoutMetrics.displayType = DisplayType::None;
  f.m.mount({ShadowViewMutation::UpdateMutation(f.card, hiddenCard, MountedViews::kSurface)});
  [f.m.window makeFirstResponder:nil];
  CHECK(walk(f.m, 5) == Tags{8, 2, 4, 7, 10});
}

TEST_CASE("a view made unfocusable and focusable again by later commits takes the focus again") {
  Form f;
  f.m.update(f.card, viewProps(folly::dynamic::object("focusable", false)));
  CHECK_FALSE(f.m.view(3).acceptsFirstResponder);
  CHECK(walk(f.m, 5) == Tags{8, 2, 7, 10, 8});
  f.m.update(f.card, viewProps(folly::dynamic::object("focusable", true)));
  CHECK(f.m.view(3).acceptsFirstResponder);
  [f.m.window makeFirstResponder:nil];
  CHECK(walk(f.m, 3) == Tags{8, 2, 3});
}

TEST_CASE("Tab with nothing focusable is not used, and leaves the focus where it was") {
  MountedViews m;
  m.add(MountedViews::shadow(2, "View", viewProps(folly::dynamic::object())));
  CHECK_FALSE(ngn::appkit::moveFocus(m.window, m.mounting->tree(), *m.backend, false, TabReach::All));
  CHECK_FALSE(focusedTag(m.window).has_value());
}
