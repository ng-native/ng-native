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

TEST_CASE("a multiline text input is a GtkTextView whose lines, changes and controlled value cross as a field's") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto input = MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("multiline", true)), {{10, 10}, {150, 80}});
  views.add(input);
  auto *field = ngn::gtk::viewData(views.view(2))->field;
  REQUIRE(field);
  REQUIRE(GTK_IS_TEXT_VIEW(field->text));
  GtkTextBuffer *buffer = gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text));
  gtk_text_buffer_insert_at_cursor(buffer, "one\ntwo", -1);
  CHECK(ngn::gtk::fieldText(*field) == "one\ntwo");
  CHECK(field->eventCount == 1);
  // The scrolled window fills the content box.
  graphene_rect_t bounds;
  REQUIRE(gtk_widget_compute_bounds(ngn::gtk::fieldWidget(*field), views.view(2), &bounds));
  CHECK(bounds.size.height == doctest::Approx(80));

  views.update(input, textInputProps(dynamic::object("multiline", true)("text", "old")("mostRecentEventCount", 0)));
  CHECK(ngn::gtk::fieldText(*field) == "one\ntwo");
  views.update(input, textInputProps(dynamic::object("multiline", true)("text", "new")("mostRecentEventCount", 1)));
  CHECK(ngn::gtk::fieldText(*field) == "new");
  CHECK(field->eventCount == 1);
}

TEST_CASE("a multiline text input keeps to maxLength in UTF-16 units, never splitting a character") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("multiline", true)("maxLength", 3)), {{10, 10}, {150, 80}}));
  auto *field = ngn::gtk::viewData(views.view(2))->field;
  GtkTextBuffer *buffer = gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text));
  gtk_text_buffer_insert_at_cursor(buffer, "a\xF0\x9F\x98\x80\xF0\x9F\x98\x80", -1);
  // One unit, then two: the second emoji does not fit.
  CHECK(ngn::gtk::fieldText(*field) == "a\xF0\x9F\x98\x80");
  gtk_text_buffer_insert_at_cursor(buffer, "b", -1);
  CHECK(ngn::gtk::fieldText(*field) == "a\xF0\x9F\x98\x80");
}

TEST_CASE("a selection prop is applied when it is new, and an unchanged one leaves the user's selection") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    auto props = [multiline](dynamic extra) {
      extra["multiline"] = multiline;
      extra["text"] = "a\xF0\x9F\x98\x80" "bcd";
      return textInputProps(std::move(extra));
    };
    auto input = MountedViews::shadow(2, "TextInput", props(dynamic::object("selection", dynamic::object("start", 3)("end", 5))), {{10, 10}, {150, 80}});
    views.add(input);
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    auto selection = [field, multiline] {
      int start = 0, end = 0;
      if (multiline) {
        GtkTextIter a, b;
        gtk_text_buffer_get_selection_bounds(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text)), &a, &b);
        start = gtk_text_iter_get_offset(&a);
        end = gtk_text_iter_get_offset(&b);
      } else {
        gtk_editable_get_selection_bounds(GTK_EDITABLE(field->text), &start, &end);
      }
      return std::make_pair(std::min(start, end), std::max(start, end));
    };
    // UTF-16 units 3 to 5 are characters 2 to 4.
    CHECK(selection() == std::make_pair(2, 4));
    // The user moves it; the same prop again leaves it there.
    views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(0, nullptr, 0, 1));
    views.update(input, props(dynamic::object("selection", dynamic::object("start", 3)("end", 5))("placeholder", "x")));
    CHECK(selection() == std::make_pair(0, 1));
    views.update(input, props(dynamic::object("selection", dynamic::object("start", 5)("end", 4))));
    CHECK(selection() == std::make_pair(3, 4));
  }
}

TEST_CASE("while an input method composes, a controlled value and setTextAndSelection's text wait") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    auto input = MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("multiline", multiline)("text", "a")), {{10, 10}, {150, 80}});
    views.add(input);
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    g_signal_emit_by_name(field->text, "preedit-changed", "ka");
    CHECK(field->composing);
    views.update(input, textInputProps(dynamic::object("multiline", multiline)("text", "b")));
    views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(0, "c", 1, 1));
    CHECK(ngn::gtk::fieldText(*field) == "a");
    g_signal_emit_by_name(field->text, "preedit-changed", "");
    CHECK_FALSE(field->composing);
    views.update(input, textInputProps(dynamic::object("multiline", multiline)("text", "d")));
    CHECK(ngn::gtk::fieldText(*field) == "d");
  }
}

TEST_CASE("a text input shows its placeholder in placeholderTextColor while it is empty, one line or many") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    auto props = [multiline](bool red) {
      dynamic p = dynamic::object("multiline", multiline)("placeholder", "MMMMMMMM")("fontSize", 30);
      if (red) {
        p["placeholderTextColor"] = 0xffff0000;
      }
      return textInputProps(p);
    };
    auto input = MountedViews::shadow(2, "TextInput", props(true), {{0, 0}, {240, 80}});
    views.add(input);
    auto redPixels = [&views] {
      int red = 0;
      for (int x = 2; x < 200; x += 6) {
        for (int y = 4; y < 76; y += 4) {
          auto p = views.pixel(x, y);
          red += p.a > 100 && p.r > 150 && p.g < 100;
        }
      }
      return red;
    };
    CHECK(redPixels() > 5);
    // Without the prop, GTK's dimmed text again.
    views.update(input, props(false));
    CHECK(redPixels() == 0);
    views.update(input, props(true));
    CHECK(redPixels() > 5);
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    if (multiline) {
      gtk_text_buffer_insert_at_cursor(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text)), "x", -1);
    } else {
      int position = 0;
      gtk_editable_insert_text(GTK_EDITABLE(field->text), "x", -1, &position);
    }
    views.settle();
    CHECK(redPixels() == 0);
  }
}

TEST_CASE("autoCapitalize capitalizes what is typed or pasted, one line or many, and tells the input method") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    auto field = [&views, multiline](int tag, const std::string &capitalize, int maxLength = 0) {
      dynamic p = dynamic::object("multiline", multiline)("autoCapitalize", capitalize);
      if (maxLength) {
        p["maxLength"] = maxLength;
      }
      views.add(MountedViews::shadow(tag, "TextInput", textInputProps(p), {{0, 0}, {240, 40}}));
      return ngn::gtk::viewData(views.view(tag))->field;
    };
    auto type = [](ngn::gtk::TextField *f, const char *text) {
      if (f->scroll) {
        gtk_text_buffer_insert_at_cursor(gtk_text_view_get_buffer(GTK_TEXT_VIEW(f->text)), text, -1);
      } else {
        int position = gtk_editable_get_position(GTK_EDITABLE(f->text));
        gtk_editable_insert_text(GTK_EDITABLE(f->text), text, -1, &position);
        gtk_editable_set_position(GTK_EDITABLE(f->text), position);
      }
    };
    auto hints = [](ngn::gtk::TextField *f) {
      return f->scroll ? gtk_text_view_get_input_hints(GTK_TEXT_VIEW(f->text)) : gtk_text_get_input_hints(GTK_TEXT(f->text));
    };

    auto *characters = field(2, "characters");
    type(characters, "straße é");
    CHECK(ngn::gtk::fieldText(*characters) == "STRASSE É");
    CHECK(hints(characters) == GTK_INPUT_HINT_UPPERCASE_CHARS);

    auto *words = field(3, "words");
    type(words, "hello wo");
    type(words, "rld again");
    CHECK(ngn::gtk::fieldText(*words) == "Hello World Again");
    CHECK(hints(words) == GTK_INPUT_HINT_UPPERCASE_WORDS);

    // Each change counts once, the capitalized text being the user's.
    CHECK(words->eventCount == 2);

    auto *none = field(4, "none");
    type(none, "lower");
    CHECK(ngn::gtk::fieldText(*none) == "lower");
    CHECK(hints(none) == GTK_INPUT_HINT_NONE);

    // Sentences are the input method's to capitalize, as GTK has no rule of its own.
    auto *sentences = field(5, "sentences");
    type(sentences, "one. two");
    CHECK(ngn::gtk::fieldText(*sentences) == "one. two");
    CHECK(hints(sentences) == GTK_INPUT_HINT_UPPERCASE_SENTENCES);

    // Capitalized, then cut to maxLength in UTF-16 units.
    auto *cut = field(6, "characters", 4);
    type(cut, "abcdef");
    CHECK(ngn::gtk::fieldText(*cut) == "ABCD");
  }
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
