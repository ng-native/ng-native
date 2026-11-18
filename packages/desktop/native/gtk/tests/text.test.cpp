// Text on GTK: Pango measures what it draws, line heights included where Pango cannot set them
// (below 1.50), and a `<text-input>` is a GtkText whose changes, controlled values and selection
// cross in React Native's UTF-16 units.
#include "mounted-views.h"

#include "../pango-text.h"
#include "../text-field.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::bluish;
using ngn::testing::MountedViews;
using ngn::testing::textInputProps;

namespace {

AttributedString paragraph(const std::string &text, float lineHeight) {
  TextAttributes attributes;
  attributes.fontSize = 16;
  attributes.lineHeight = lineHeight;
  AttributedString string;
  string.appendFragment({.string = text, .textAttributes = attributes, .parentShadowView = {}});
  return string;
}

const std::string kWords = "one two three four five six seven eight nine ten";

} // namespace

TEST_CASE("each line takes the paragraph's line height, measured and placed the same with or without Pango's") {
  ngn::gtk::PangoTextMeasurer own(ngn::gtk::LineHeights::Own);
  auto text = paragraph(kWords, 30);
  auto layout = ngn::gtk::layoutText(text, {}, 80, ngn::gtk::LineHeights::Own);
  int lines = pango_layout_get_line_count(layout.layout);
  REQUIRE(lines > 2);
  CHECK(own.measure(text, {}, 80).height == doctest::Approx(30.0 * lines));
  // Half of each line's extra height goes above the first.
  PangoRectangle logical;
  pango_layout_line_get_extents(pango_layout_get_line_readonly(layout.layout, 0), nullptr, &logical);
  double natural = static_cast<double>(logical.height) / PANGO_SCALE;
  CHECK(layout.top == doctest::Approx((30 - natural) / 2).epsilon(0.05));
  // A smaller line height than the font's packs the lines tighter.
  CHECK(own.measure(paragraph(kWords, 12), {}, 80).height == doctest::Approx(12.0 * lines));

  if (ngn::gtk::pangoHasLineHeight()) {
    // Pango's own attribute, where it has one, agrees.
    ngn::gtk::PangoTextMeasurer pango(ngn::gtk::LineHeights::Auto);
    CHECK(pango.measure(text, {}, 80).height == doctest::Approx(own.measure(text, {}, 80).height).epsilon(0.02));
  }
}

TEST_CASE("text with no line height is as tall as its lines") {
  ngn::gtk::PangoTextMeasurer own(ngn::gtk::LineHeights::Own);
  auto text = paragraph("one line", 0);
  auto layout = ngn::gtk::layoutText(text, {}, 1000, ngn::gtk::LineHeights::Own);
  CHECK(layout.top == 0);
  PangoRectangle logical;
  pango_layout_get_extents(layout.layout, nullptr, &logical);
  CHECK(own.measure(text, {}, 1000).height == doctest::Approx(static_cast<double>(logical.height) / PANGO_SCALE));
}

TEST_CASE("GTK's character offsets become UTF-16 units and back, a character outside the BMP as two") {
  std::string text = "a\xF0\x9F\x98\x80" "b"; // a, U+1F600, b
  CHECK(ngn::gtk::utf16Units(text, 0) == 0);
  CHECK(ngn::gtk::utf16Units(text, 1) == 1);
  CHECK(ngn::gtk::utf16Units(text, 2) == 3);
  CHECK(ngn::gtk::utf16Units(text, 3) == 4);
  CHECK(ngn::gtk::charactersIn(text, 3) == 2);
  CHECK(ngn::gtk::charactersIn(text, 4) == 3);
  // Inside the pair: the character before it.
  CHECK(ngn::gtk::charactersIn(text, 2) == 1);
}

TEST_CASE("a text input is a GtkText the user's changes count on, and a controlled value waits for them") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto input = MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("placeholder", "Name")), {{10, 10}, {150, 40}});
  views.add(input);
  auto *data = ngn::gtk::viewData(views.view(2));
  REQUIRE(data->field);
  GtkEditable *text = GTK_EDITABLE(data->field->text);
  CHECK(std::string(gtk_text_get_placeholder_text(GTK_TEXT(data->field->text))) == "Name");

  int position = 0;
  gtk_editable_insert_text(text, "typed", -1, &position);
  CHECK(data->field->eventCount == 1);

  // JavaScript's value from before the change is stale: the user's text stays.
  views.update(input, textInputProps(dynamic::object("text", "old")("mostRecentEventCount", 0)));
  CHECK(std::string(gtk_editable_get_text(text)) == "typed");
  // One that has seen it replaces it, and counts as no change of the user's.
  views.update(input, textInputProps(dynamic::object("text", "new")("mostRecentEventCount", 1)));
  CHECK(std::string(gtk_editable_get_text(text)) == "new");
  CHECK(data->field->eventCount == 1);
}

TEST_CASE("setTextAndSelection selects by UTF-16 units") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object()), {{10, 10}, {150, 40}}));
  auto *data = ngn::gtk::viewData(views.view(2));
  views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(0, "a\xF0\x9F\x98\x80" "bc", 3, 4));
  int start = 0, end = 0;
  REQUIRE(gtk_editable_get_selection_bounds(GTK_EDITABLE(data->field->text), &start, &end));
  CHECK(start == 2);
  CHECK(end == 3);
}

TEST_CASE("a text input's border and background are its view's, painted under the field") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic props = dynamic::object("borderWidth", 3)("borderColor", 0xff0000ff)("padding", 8);
  auto input = MountedViews::shadow(2, "TextInput", textInputProps(props), {{10, 10}, {150, 40}});
  input.layoutMetrics.contentInsets = {11, 11, 11, 11};
  views.add(input);
  CHECK(bluish(views.pixel(80, 11)));
  CHECK(bluish(views.pixel(11, 30)));
  // The field sits in the content box.
  graphene_rect_t bounds;
  REQUIRE(gtk_widget_compute_bounds(ngn::gtk::viewData(views.view(2))->field->text, views.view(2), &bounds));
  CHECK(bounds.origin.x == doctest::Approx(11));
  CHECK(bounds.size.width == doctest::Approx(128));
}
