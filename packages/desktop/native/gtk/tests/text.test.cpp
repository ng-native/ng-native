// Text on GTK: Pango measures what it draws, line heights included where Pango cannot set them
// (below 1.50), and a `<text-input>` is a GtkText whose changes, controlled values and selection
// cross in React Native's UTF-16 units.
#include "mounted-views.h"

#include "../pango-text.h"
#include "../text-field.h"

#include <adwaita.h>
#include <doctest/doctest.h>

#include <react/renderer/components/textinput/TextInputEventEmitter.h>

#include <algorithm>
#include <chrono>
#include <string>
#include <optional>
#include <utility>
#include <vector>

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

// `text` in a 300-point box, aligned as asked in a layout of `direction`: where its line starts,
// and where it ends, in points from the box's left.
std::pair<double, double> lineSpan(const std::string &text, std::optional<TextAlignment> alignment,
                                   LayoutDirection direction = LayoutDirection::LeftToRight) {
  TextAttributes attributes;
  attributes.fontSize = 16;
  attributes.alignment = alignment;
  attributes.layoutDirection = direction;
  AttributedString string;
  string.appendFragment({.string = text, .textAttributes = attributes, .parentShadowView = {}});
  auto layout = ngn::gtk::layoutText(string, {}, 300, ngn::gtk::LineHeights::Own);
  PangoRectangle logical;
  pango_layout_get_extents(layout.layout, nullptr, &logical);
  double x = static_cast<double>(logical.x) / PANGO_SCALE;
  return {x, x + static_cast<double>(logical.width) / PANGO_SCALE};
}

const std::string kHebrew = "\xD7\xA9\xD7\x9C\xD7\x95\xD7\x9D \xD7\xA2\xD7\x95\xD7\x9C\xD7\x9D";
const std::string kArabic = "\xD8\xB3\xD8\xA7\xD8\xB1\xD8\xA7";

const std::string kWords = "one two three four five six seven eight nine ten";

// Presses a key through the field's own key controller, which GTK gives a key before the editor.
bool pressKey(GtkWidget *editor, guint keyval, GdkModifierType state, guint keycode = 0) {
  GListModel *controllers = gtk_widget_observe_controllers(editor);
  gboolean handled = FALSE;
  for (guint i = 0; i < g_list_model_get_n_items(controllers) && !handled; ++i) {
    auto *controller = GTK_EVENT_CONTROLLER(g_list_model_get_item(controllers, i));
    if (GTK_IS_EVENT_CONTROLLER_KEY(controller) && gtk_event_controller_get_propagation_phase(controller) == GTK_PHASE_CAPTURE) {
      g_signal_emit_by_name(controller, "key-pressed", keyval, keycode, state, &handled);
    }
    g_object_unref(controller);
  }
  g_object_unref(controllers);
  return handled;
}

// The hardware key that makes `keyval` in the first layout group, or 0 when no key there does.
guint firstGroupKeycode(GtkWidget *widget, guint keyval) {
  GdkKeymapKey *keys = nullptr;
  int count = 0;
  guint keycode = 0;
  if (gdk_display_map_keyval(gtk_widget_get_display(widget), keyval, &keys, &count)) {
    for (int i = 0; i < count && !keycode; ++i) {
      keycode = keys[i].group == 0 ? keys[i].keycode : 0;
    }
    g_free(keys);
  }
  return keycode;
}

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

TEST_CASE("text aligns by the layout's direction, whatever its script's, as on macOS and iOS") {
  auto atLeft = [](std::pair<double, double> span) { return span.first < 1; };
  auto atRight = [](std::pair<double, double> span) { return span.second > 299; };
  for (const auto &text : {kHebrew, kArabic, std::string("Hello")}) {
    CAPTURE(text);
    // A left-to-right layout: natural and left are its start, right and end its end.
    CHECK(atLeft(lineSpan(text, std::nullopt)));
    CHECK(atLeft(lineSpan(text, TextAlignment::Natural)));
    CHECK(atLeft(lineSpan(text, TextAlignment::Left)));
    CHECK(atRight(lineSpan(text, TextAlignment::Right)));
    // A right-to-left layout mirrors them.
    CHECK(atRight(lineSpan(text, std::nullopt, LayoutDirection::RightToLeft)));
    CHECK(atRight(lineSpan(text, TextAlignment::Left, LayoutDirection::RightToLeft)));
    CHECK(atLeft(lineSpan(text, TextAlignment::Right, LayoutDirection::RightToLeft)));
    // The script still orders its own letters: a Hebrew or Arabic line is laid out right to left.
    if (text != "Hello") {
      TextAttributes attributes;
      attributes.fontSize = 16;
      AttributedString string;
      string.appendFragment({.string = text, .textAttributes = attributes, .parentShadowView = {}});
      auto layout = ngn::gtk::layoutText(string, {}, 300, ngn::gtk::LineHeights::Own);
      CHECK(pango_layout_get_line_readonly(layout.layout, 0)->resolved_dir == PANGO_DIRECTION_RTL);
    }
    // Centred is centred.
    auto centre = lineSpan(text, TextAlignment::Center);
    CHECK((centre.first + centre.second) / 2 == doctest::Approx(150).epsilon(0.02));
  }
}

TEST_CASE("a justified paragraph's last line follows the paragraph's own direction, as on macOS") {
  // Where its last line starts and ends: a justified paragraph's other lines fill the width.
  auto lastLine = [](const std::string &text, LayoutDirection direction) {
    TextAttributes attributes;
    attributes.fontSize = 16;
    attributes.alignment = TextAlignment::Justified;
    attributes.layoutDirection = direction;
    AttributedString string;
    string.appendFragment({.string = text, .textAttributes = attributes, .parentShadowView = {}});
    auto layout = ngn::gtk::layoutText(string, {}, 300, ngn::gtk::LineHeights::Own);
    PangoLayoutIter *iter = pango_layout_get_iter(layout.layout);
    while (pango_layout_iter_next_line(iter)) {
    }
    PangoRectangle logical;
    pango_layout_iter_get_line_extents(iter, nullptr, &logical);
    pango_layout_iter_free(iter);
    double x = static_cast<double>(logical.x) / PANGO_SCALE;
    return std::pair{x, x + static_cast<double>(logical.width) / PANGO_SCALE};
  };
  std::string wrapped;
  for (int i = 0; i < 6; i++) {
    wrapped += kHebrew + " ";
  }
  wrapped += kHebrew;
  for (auto direction : {LayoutDirection::LeftToRight, LayoutDirection::RightToLeft}) {
    CAPTURE(static_cast<int>(direction));
    // Hebrew ends at the right, a short paragraph and a wrapped one's last line alike.
    CHECK(lastLine(kHebrew, direction).second > 299);
    CHECK(lastLine(wrapped, direction).second > 299);
    // English at the left.
    CHECK(lastLine("Hello", direction).first < 1);
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
    while (g_main_context_iteration(nullptr, false)) {
    }
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

TEST_CASE("a placeholder with no colour of its own is the theme's text, dimmed, light or dark, one line or many") {
  REQUIRE(ngn::testing::gtkReady());
  AdwStyleManager *styles = adw_style_manager_get_default();
  struct Restore {
    AdwStyleManager *styles;
    ~Restore() {
      adw_style_manager_set_color_scheme(styles, ADW_COLOR_SCHEME_DEFAULT);
    }
  } restore{styles};
  for (bool dark : {false, true}) {
    adw_style_manager_set_color_scheme(styles, dark ? ADW_COLOR_SCHEME_FORCE_DARK : ADW_COLOR_SCHEME_FORCE_LIGHT);
    for (bool multiline : {false, true}) {
      CAPTURE(dark);
      CAPTURE(multiline);
      MountedViews views;
      auto input = MountedViews::shadow(
          2, "TextInput", textInputProps(dynamic::object("multiline", multiline)("placeholder", "MMMMMMMM")("fontSize", 30)),
          {{0, 0}, {240, 80}});
      views.add(input);
      views.settle();
      // The most opaque pixel the placeholder drew, and whether it was light.
      int alpha = 0;
      bool light = false;
      for (int x = 2; x < 230; x += 5) {
        for (int y = 2; y < 78; y += 3) {
          auto p = views.pixel(x, y);
          if (p.a > alpha) {
            alpha = p.a;
            light = p.r > 128;
          }
        }
      }
      // Drawn, in the theme's text colour, and dimmed so it never reads as typed text.
      CHECK(alpha > 40);
      CHECK(alpha < 200);
      CHECK(light == dark);
    }
  }
}

TEST_CASE("a placeholder dims a theme's translucent text further, never drawing more solid than it") {
  REQUIRE(ngn::testing::gtkReady());
  // A theme whose text is itself 40% opaque.
  GtkCssProvider *css = gtk_css_provider_new();
  gtk_css_provider_load_from_data(css, "text, textview, textview text, label { color: rgba(0, 0, 0, 0.4); }", -1);
  gtk_style_context_add_provider_for_display(gdk_display_get_default(), GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_USER);
  struct Restore {
    GtkCssProvider *css;
    ~Restore() {
      gtk_style_context_remove_provider_for_display(gdk_display_get_default(), GTK_STYLE_PROVIDER(css));
      g_object_unref(css);
    }
  } restore{css};
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    views.add(MountedViews::shadow(
        2, "TextInput", textInputProps(dynamic::object("multiline", multiline)("placeholder", "MMMMMMMM")("fontSize", 30)),
        {{0, 0}, {240, 80}}));
    views.settle();
    int alpha = 0;
    for (int x = 2; x < 230; x += 5) {
      for (int y = 2; y < 78; y += 3) {
        alpha = std::max(alpha, static_cast<int>(views.pixel(x, y).a));
      }
    }
    CHECK(alpha > 10);
    // Half the text's 0.4: below the 102 of typed text, which an absolute 0.5 (127) is above.
    CHECK(alpha < 80);
  }
}

TEST_CASE("a placeholder dims from the theme's text as it is when the theme changes after it is shown") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    views.add(MountedViews::shadow(
        2, "TextInput", textInputProps(dynamic::object("multiline", multiline)("placeholder", "MMMMMMMM")("fontSize", 30)),
        {{0, 0}, {240, 80}}));
    views.settle();
    auto mostOpaque = [&views] {
      int alpha = 0;
      for (int x = 2; x < 230; x += 5) {
        for (int y = 2; y < 78; y += 3) {
          alpha = std::max(alpha, static_cast<int>(views.pixel(x, y).a));
        }
      }
      return alpha;
    };
    REQUIRE(mostOpaque() > 80);
    // The theme's text turns 40% opaque, with no prop or layout change to the field.
    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css, "text, textview, textview text, label { color: rgba(0, 0, 0, 0.4); }", -1);
    gtk_style_context_add_provider_for_display(gdk_display_get_default(), GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_USER);
    struct Restore {
      GtkCssProvider *css;
      ~Restore() {
        gtk_style_context_remove_provider_for_display(gdk_display_get_default(), GTK_STYLE_PROVIDER(css));
        g_object_unref(css);
      }
    } restore{css};
    views.settle();
    CHECK(mostOpaque() > 10);
    // Half the text's 0.4, as it would be had the theme been so from the start.
    CHECK(mostOpaque() < 80);
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

TEST_CASE("setTextAndSelection with a stale count, sent as a double, leaves the user's text") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object()), {{10, 10}, {150, 40}}));
  auto *data = ngn::gtk::viewData(views.view(2));
  int position = 0;
  gtk_editable_insert_text(GTK_EDITABLE(data->field->text), "typed", -1, &position);
  REQUIRE(data->field->eventCount == 1);
  views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(0.0, "stale", 0, 0));
  CHECK(std::string(gtk_editable_get_text(GTK_EDITABLE(data->field->text))) == "typed");
}

TEST_CASE("a layout update does not put a controlled value back over setTextAndSelection") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto input = MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("text", "seed")), {{10, 10}, {150, 40}});
  views.add(input);
  auto *data = ngn::gtk::viewData(views.view(2));
  GtkEditable *text = GTK_EDITABLE(data->field->text);
  REQUIRE(std::string(gtk_editable_get_text(text)) == "seed");
  views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(0, "replacement", 0, 0));
  CHECK(std::string(gtk_editable_get_text(text)) == "replacement");

  // The same props, laid out again at another size.
  auto moved = views.mounting->tree().find(2)->view;
  moved.layoutMetrics.frame.size = {200, 40};
  views.backend->updateLayout(moved);
  CHECK(std::string(gtk_editable_get_text(text)) == "replacement");
  // New props with a value still apply it.
  views.update(input, textInputProps(dynamic::object("text", "next")));
  CHECK(std::string(gtk_editable_get_text(text)) == "next");
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

TEST_CASE("the text size follows the desktop's text scaling, and a change to it is heard") {
  REQUIRE(ngn::testing::gtkReady());
  GtkSettings *settings = gtk_settings_get_default();
  REQUIRE(settings);
  int saved = 0;
  g_object_get(settings, "gtk-xft-dpi", &saved, nullptr);
  struct Restore {
    GtkSettings *settings;
    int dpi;
    ~Restore() {
      g_object_set(settings, "gtk-xft-dpi", dpi, nullptr);
    }
  } restore{settings, saved};
  auto heard = std::make_shared<int>(0);
  ngn::gtk::watchFontScale([heard] { ++*heard; });

  g_object_set(settings, "gtk-xft-dpi", 120 * 1024, nullptr);
  CHECK(ngn::gtk::desktopFontScale() == doctest::Approx(1.25));
  CHECK(*heard == 1);
  g_object_set(settings, "gtk-xft-dpi", 96 * 1024, nullptr);
  CHECK(ngn::gtk::desktopFontScale() == doctest::Approx(1));
  CHECK(*heard == 2);
}

TEST_CASE("a multiline text input sends a selection change when an edit moves its cursor, and when the user does") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("multiline", true)), {{10, 10}, {150, 80}}));
  auto *data = ngn::gtk::viewData(views.view(2));
  ngn::testing::SentEvents<TextInputEventEmitter> sent(*data);
  GtkTextBuffer *buffer = gtk_text_view_get_buffer(GTK_TEXT_VIEW(data->field->text));
  // Typing moves the cursor without setting its mark.
  gtk_text_buffer_insert_interactive_at_cursor(buffer, "a", -1, TRUE);
  CHECK(sent.count("topChange") == 1);
  CHECK(sent.count("topSelectionChange") >= 1);
  // Moving the cursor alone, and then selecting, still do.
  sent.types.clear();
  GtkTextIter at;
  gtk_text_buffer_get_start_iter(buffer, &at);
  gtk_text_buffer_move_mark(buffer, gtk_text_buffer_get_insert(buffer), &at);
  CHECK(sent.count("topSelectionChange") >= 1);
  sent.types.clear();
  GtkTextIter end;
  gtk_text_buffer_get_end_iter(buffer, &end);
  gtk_text_buffer_move_mark(buffer, gtk_text_buffer_get_selection_bound(buffer), &end);
  CHECK(sent.count("topSelectionChange") >= 1);
  // A value from JavaScript sends none.
  sent.types.clear();
  views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(1, "bc", 2, 2));
  CHECK(sent.types.empty());
  data->emitter = nullptr;
}

TEST_CASE("a multiline field's buffer, kept alive after its view goes, signals into no freed field") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto input = MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("multiline", true)), {{10, 10}, {150, 80}});
  views.add(input);
  auto *field = ngn::gtk::viewData(views.view(2))->field;
  // As GTK keeps it for a paste still to arrive.
  GtkTextBuffer *buffer = GTK_TEXT_BUFFER(g_object_ref(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text))));
  views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, input, 0), ShadowViewMutation::DeleteMutation(input)});
  REQUIRE(views.view(2) == nullptr);
  bool connected = g_signal_handler_find(buffer, G_SIGNAL_MATCH_DATA, 0, 0, nullptr, nullptr, field) != 0;
  CHECK_FALSE(connected);
  if (!connected) {
    gtk_text_buffer_insert_at_cursor(buffer, "pasted", -1);
  }
  g_object_unref(buffer);
}

TEST_CASE("a controlled value that waited for an input method applies when it ends, unless something newer came") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    auto props = [multiline](dynamic extra) {
      extra["multiline"] = multiline;
      return textInputProps(std::move(extra));
    };
    auto input = MountedViews::shadow(2, "TextInput", props(dynamic::object("text", "a")), {{10, 10}, {150, 80}});
    views.add(input);
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    // The held value applies from an idle source, after any commit that follows the empty preedit.
    auto compose = [field](const char *preedit) {
      g_signal_emit_by_name(field->text, "preedit-changed", preedit);
      while (g_main_context_iteration(nullptr, false)) {
      }
    };

    // The value that arrived while composing.
    compose("ka");
    views.update(input, props(dynamic::object("text", "b")));
    CHECK(ngn::gtk::fieldText(*field) == "a");
    compose("");
    CHECK(ngn::gtk::fieldText(*field) == "b");
    // Laid out again with the same props, after a setTextAndSelection: the value stays applied once.
    views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(0, "set", 0, 0));
    auto moved = views.mounting->tree().find(2)->view;
    moved.layoutMetrics.frame.size = {160, 80};
    views.backend->updateLayout(moved);
    CHECK(ngn::gtk::fieldText(*field) == "set");
    compose("ka");
    compose("");
    CHECK(ngn::gtk::fieldText(*field) == "set");

    // A setTextAndSelection after it is newer.
    compose("ka");
    views.update(input, props(dynamic::object("text", "c")));
    views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(0, "d", 1, 1));
    compose("");
    CHECK(ngn::gtk::fieldText(*field) == "d");

    // A change of the user's that JavaScript has not seen makes it stale.
    compose("ka");
    views.update(input, props(dynamic::object("text", "e")("mostRecentEventCount", field->eventCount)));
    if (multiline) {
      gtk_text_buffer_insert_at_cursor(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text)), "!", -1);
    } else {
      int position = 1;
      gtk_editable_insert_text(GTK_EDITABLE(field->text), "!", -1, &position);
    }
    compose("");
    CHECK(ngn::gtk::fieldText(*field) == "d!");
  }
}

TEST_CASE("a multiline placeholder taller than its field is clipped to the field's content box") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic props = dynamic::object("multiline", true)("placeholder", "MMM MMM MMM MMM MMM MMM MMM MMM MMM MMM")("placeholderTextColor", 0xffff0000)("fontSize", 30);
  views.add(MountedViews::shadow(2, "TextInput", textInputProps(props), {{0, 0}, {200, 40}}));
  int inside = 0, below = 0;
  for (int x = 4; x < 190; x += 10) {
    for (int y : {8, 16, 24, 32, 48, 60, 72, 84, 96, 108, 120, 132, 144, 156, 168, 180}) {
      auto p = views.pixel(x, y);
      bool red = p.a > 100 && p.r > 150 && p.g < 100;
      (y < 40 ? inside : below) += red;
    }
  }
  CHECK(inside > 5);
  CHECK(below == 0);
}

TEST_CASE("undo and redo put back what the field had, not capitalized again, one line or many") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    views.add(MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("multiline", multiline)("autoCapitalize", "characters")("defaultValue", "\xC3\x9F")), {{10, 10}, {150, 80}}));
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    REQUIRE(ngn::gtk::fieldText(*field) == "\xC3\x9F");
    if (multiline) {
      GtkTextBuffer *buffer = gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text));
      GtkTextIter end;
      gtk_text_buffer_get_end_iter(buffer, &end);
      gtk_text_buffer_place_cursor(buffer, &end);
    } else {
      gtk_editable_set_position(GTK_EDITABLE(field->text), -1);
    }
    g_signal_emit_by_name(field->text, "backspace");
    REQUIRE(ngn::gtk::fieldText(*field).empty());
    int before = field->eventCount;
    if (!multiline && gtk_check_version(4, 12, 3)) {
      // GTK before 4.12.3 deletes on Backspace outside a change, which it cannot undo.
      continue;
    }
    // A single line's undo and redo are its keys; a multiline field's, its buffer's.
    auto replay = [&](bool redo) {
      if (multiline) {
        gtk_widget_activate_action(field->text, redo ? "text.redo" : "text.undo", nullptr);
      } else {
        CHECK(pressKey(field->text, redo ? GDK_KEY_y : GDK_KEY_z, GDK_CONTROL_MASK));
      }
    };
    replay(false);
    CHECK(ngn::gtk::fieldText(*field) == "\xC3\x9F");
    // Still the user's change, which JavaScript hears of.
    CHECK(field->eventCount > before);
    replay(true);
    CHECK(ngn::gtk::fieldText(*field).empty());
    // What is typed afterwards is capitalized as before.
    if (multiline) {
      gtk_text_buffer_insert_at_cursor(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text)), "a", -1);
    } else {
      int position = 0;
      gtk_editable_insert_text(GTK_EDITABLE(field->text), "a", -1, &position);
    }
    CHECK(ngn::gtk::fieldText(*field) == "A");
  }
}

TEST_CASE("a single line's Undo and Redo keys put back what the field had, not capitalized again") {
  REQUIRE(ngn::testing::gtkReady());
  // GTK before 4.12.3 deletes on Backspace outside a change, which it cannot undo.
  if (gtk_check_version(4, 12, 3)) {
    return;
  }
  MountedViews views;
  views.add(MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("autoCapitalize", "characters")("defaultValue", "\xC3\x9F")), {{10, 10}, {150, 80}}));
  auto *field = ngn::gtk::viewData(views.view(2))->field;
  gtk_editable_set_position(GTK_EDITABLE(field->text), -1);
  g_signal_emit_by_name(field->text, "backspace");
  REQUIRE(ngn::gtk::fieldText(*field).empty());
  CHECK(pressKey(field->text, GDK_KEY_Undo, GdkModifierType(0)));
  CHECK(ngn::gtk::fieldText(*field) == "\xC3\x9F");
  CHECK(pressKey(field->text, GDK_KEY_Redo, GdkModifierType(0)));
  CHECK(ngn::gtk::fieldText(*field).empty());
}

TEST_CASE("a single line's undo and redo keys work on a layout whose letters are not Latin") {
  REQUIRE(ngn::testing::gtkReady());
  // GTK before 4.12.3 deletes on Backspace outside a change, which it cannot undo.
  if (gtk_check_version(4, 12, 3)) {
    return;
  }
  MountedViews views;
  views.add(MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("autoCapitalize", "characters")("defaultValue", "\xC3\x9F")), {{10, 10}, {150, 80}}));
  auto *field = ngn::gtk::viewData(views.view(2))->field;
  gtk_editable_set_position(GTK_EDITABLE(field->text), -1);
  g_signal_emit_by_name(field->text, "backspace");
  REQUIRE(ngn::gtk::fieldText(*field).empty());
  // The hardware key that makes a Latin z in the first group makes Cyrillic ya on a Russian layout.
  guint keycode = firstGroupKeycode(field->text, GDK_KEY_z);
  if (!keycode) {
    return;
  }
  CHECK(pressKey(field->text, GDK_KEY_Cyrillic_ya, GDK_CONTROL_MASK, keycode));
  CHECK(ngn::gtk::fieldText(*field) == "\xC3\x9F");
  CHECK(pressKey(field->text, GDK_KEY_Cyrillic_YA, static_cast<GdkModifierType>(GDK_CONTROL_MASK | GDK_SHIFT_MASK), keycode));
  CHECK(ngn::gtk::fieldText(*field).empty());
}

TEST_CASE("a single line's undo and redo keys follow the Latin letter the active layout made") {
  REQUIRE(ngn::testing::gtkReady());
  // GTK before 4.12.3 deletes on Backspace outside a change, which it cannot undo.
  if (gtk_check_version(4, 12, 3)) {
    return;
  }
  MountedViews views;
  views.add(MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("autoCapitalize", "characters")("defaultValue", "\xC3\x9F")), {{10, 10}, {150, 80}}));
  auto *field = ngn::gtk::viewData(views.view(2))->field;
  gtk_editable_set_position(GTK_EDITABLE(field->text), -1);
  g_signal_emit_by_name(field->text, "backspace");
  REQUIRE(ngn::gtk::fieldText(*field).empty());
  CHECK(pressKey(field->text, GDK_KEY_z, GDK_CONTROL_MASK));
  REQUIRE(ngn::gtk::fieldText(*field) == "\xC3\x9F");
  // The hardware key that makes a Latin z in the first group makes y on a German layout and w on a
  // French one.
  guint keycode = firstGroupKeycode(field->text, GDK_KEY_z);
  if (!keycode) {
    return;
  }
  CHECK_FALSE(pressKey(field->text, GDK_KEY_w, GDK_CONTROL_MASK, keycode));
  CHECK(ngn::gtk::fieldText(*field) == "\xC3\x9F");
  CHECK(pressKey(field->text, GDK_KEY_y, GDK_CONTROL_MASK, keycode));
  CHECK(ngn::gtk::fieldText(*field).empty());
}

TEST_CASE("Backspace over a mark puts its base back as it was, not capitalized, one line or many") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    // Armenian small ayb and a combining acute: Pango lets Backspace delete the acute alone, which
    // GTK does by deleting both and putting the ayb back.
    views.add(MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("multiline", multiline)("autoCapitalize", "characters")("defaultValue", "\xD5\xA1\xCC\x81")), {{10, 10}, {150, 80}}));
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    if (multiline) {
      GtkTextBuffer *buffer = gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text));
      GtkTextIter end;
      gtk_text_buffer_get_end_iter(buffer, &end);
      gtk_text_buffer_place_cursor(buffer, &end);
    } else {
      gtk_editable_set_position(GTK_EDITABLE(field->text), -1);
    }
    int before = field->eventCount;
    g_signal_emit_by_name(field->text, "backspace");
    CHECK(ngn::gtk::fieldText(*field) == "\xD5\xA1");
    // Still the user's change, which JavaScript hears of.
    CHECK(field->eventCount > before);
    // What is typed afterwards is capitalized as before.
    if (multiline) {
      gtk_text_buffer_insert_at_cursor(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text)), "\xD5\xA1", -1);
    } else {
      int position = gtk_editable_get_position(GTK_EDITABLE(field->text));
      gtk_editable_insert_text(GTK_EDITABLE(field->text), "\xD5\xA1", -1, &position);
    }
    CHECK(ngn::gtk::fieldText(*field) == "\xD5\xA1\xD4\xB1");
  }
}

TEST_CASE("autoCapitalize words fits a long paste in linear time, and maxLength never cuts inside a character") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("autoCapitalize", "words")("maxLength", 4)), {{10, 10}, {150, 40}}));
  views.add(MountedViews::shadow(3, "TextInput", textInputProps(dynamic::object("autoCapitalize", "words")("maxLength", 2)), {{10, 50}, {150, 40}}));
  auto *pasted = ngn::gtk::viewData(views.view(2))->field;
  auto *marked = ngn::gtk::viewData(views.view(3))->field;
  std::string paste(200000, 'a');
  int position = 0;
  auto started = std::chrono::steady_clock::now();
  gtk_editable_insert_text(GTK_EDITABLE(pasted->text), paste.c_str(), -1, &position);
  auto took = std::chrono::steady_clock::now() - started;
  CHECK(ngn::gtk::fieldText(*pasted) == "Aaaa");
  // Linear, this takes milliseconds; scanning from the start for each character, close to a minute.
  // A bound far from both holds on a busy machine.
  CHECK(took < std::chrono::seconds(5));
  // b with a combining acute is one character over two units: the cut keeps all of it or none.
  position = 0;
  gtk_editable_insert_text(GTK_EDITABLE(marked->text), "ab\xCC\x81", -1, &position);
  CHECK(ngn::gtk::fieldText(*marked) == "A");
}

TEST_CASE("a commit that follows the empty preedit lands on the text the user composed against") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    auto props = [multiline](dynamic extra) {
      extra["multiline"] = multiline;
      return textInputProps(std::move(extra));
    };
    auto input = MountedViews::shadow(2, "TextInput", props(dynamic::object("text", "a")), {{10, 10}, {150, 80}});
    views.add(input);
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    auto pump = [] {
      while (g_main_context_iteration(nullptr, false)) {
      }
    };
    auto commit = [&](const char *text) {
      if (multiline) {
        gtk_text_buffer_insert_at_cursor(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text)), text, -1);
      } else {
        int position = 1;
        gtk_editable_insert_text(GTK_EDITABLE(field->text), text, -1, &position);
      }
    };
    g_signal_emit_by_name(field->text, "preedit-changed", "ka");
    views.update(input, props(dynamic::object("text", "b")("mostRecentEventCount", 0)));
    // The input method ends the preedit, then commits.
    g_signal_emit_by_name(field->text, "preedit-changed", "");
    commit("c");
    pump();
    CHECK(ngn::gtk::fieldText(*field) == "ac");
    CHECK_FALSE(field->pendingText);
  }
}

TEST_CASE("props older than a held controlled value leave it for composition's end") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    auto props = [multiline](dynamic extra) {
      extra["multiline"] = multiline;
      return textInputProps(std::move(extra));
    };
    auto input = MountedViews::shadow(2, "TextInput", props(dynamic::object("text", "a")), {{10, 10}, {150, 80}});
    views.add(input);
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    if (multiline) {
      gtk_text_buffer_insert_at_cursor(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text)), "!", -1);
    } else {
      int position = 1;
      gtk_editable_insert_text(GTK_EDITABLE(field->text), "!", -1, &position);
    }
    REQUIRE(field->eventCount == 1);
    g_signal_emit_by_name(field->text, "preedit-changed", "ka");
    views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(1, "b", 0, 0));
    // Props that have not seen the user's change cannot supersede the command.
    views.update(input, props(dynamic::object("text", "a")("placeholder", "p")("mostRecentEventCount", 0)));
    g_signal_emit_by_name(field->text, "preedit-changed", "");
    while (g_main_context_iteration(nullptr, false)) {
    }
    CHECK(ngn::gtk::fieldText(*field) == "b");
  }
}

TEST_CASE("setTextAndSelection's range applies to the text held while composing") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    auto input = MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("multiline", multiline)("text", "a")), {{10, 10}, {150, 80}});
    views.add(input);
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    g_signal_emit_by_name(field->text, "preedit-changed", "ka");
    views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(0, "abcd", 1, 3));
    g_signal_emit_by_name(field->text, "preedit-changed", "");
    while (g_main_context_iteration(nullptr, false)) {
    }
    CHECK(ngn::gtk::fieldText(*field) == "abcd");
    int start = 0, end = 0;
    if (multiline) {
      GtkTextIter a, b;
      gtk_text_buffer_get_selection_bounds(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text)), &a, &b);
      start = gtk_text_iter_get_offset(&a);
      end = gtk_text_iter_get_offset(&b);
    } else {
      gtk_editable_get_selection_bounds(GTK_EDITABLE(field->text), &start, &end);
    }
    CHECK(start == 1);
    CHECK(end == 3);
  }
}

namespace {

std::pair<int, int> selectionOf(const ngn::gtk::TextField &field) {
  int start = 0, end = 0;
  if (GTK_IS_TEXT_VIEW(field.text)) {
    GtkTextIter a, b;
    gtk_text_buffer_get_selection_bounds(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field.text)), &a, &b);
    start = gtk_text_iter_get_offset(&a);
    end = gtk_text_iter_get_offset(&b);
  } else {
    gtk_editable_get_selection_bounds(GTK_EDITABLE(field.text), &start, &end);
  }
  return {start, end};
}

void settle() {
  while (g_main_context_iteration(nullptr, false)) {
  }
}

} // namespace

TEST_CASE("a props update that repeats the shown text leaves a held setTextAndSelection") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    auto props = [multiline](dynamic extra) {
      extra["multiline"] = multiline;
      extra["text"] = "a";
      return textInputProps(std::move(extra));
    };
    auto input = MountedViews::shadow(2, "TextInput", props(dynamic::object()), {{10, 10}, {150, 80}});
    views.add(input);
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    g_signal_emit_by_name(field->text, "preedit-changed", "ka");
    views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(0, "abcd", 1, 3));
    views.update(input, props(dynamic::object("placeholder", "p")));
    g_signal_emit_by_name(field->text, "preedit-changed", "");
    settle();
    CHECK(ngn::gtk::fieldText(*field) == "abcd");
    CHECK(selectionOf(*field) == std::make_pair(1, 3));
  }
}

TEST_CASE("props that answer an edit made after a held setTextAndSelection replace it, though their text repeats") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    auto props = [multiline](dynamic extra) {
      extra["multiline"] = multiline;
      extra["text"] = "a";
      return textInputProps(std::move(extra));
    };
    auto input = MountedViews::shadow(2, "TextInput", props(dynamic::object()), {{10, 10}, {150, 80}});
    views.add(input);
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    g_signal_emit_by_name(field->text, "preedit-changed", "ka");
    views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(0, "b", 0, 0));
    // The input method commits part of what is composed and goes on composing.
    if (multiline) {
      gtk_text_buffer_insert_at_cursor(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text)), "!", -1);
    } else {
      int position = 1;
      gtk_editable_insert_text(GTK_EDITABLE(field->text), "!", -1, &position);
    }
    REQUIRE(field->eventCount == 1);
    // JavaScript answers that edit by keeping its value.
    views.update(input, props(dynamic::object("mostRecentEventCount", 1)));
    g_signal_emit_by_name(field->text, "preedit-changed", "");
    settle();
    CHECK(ngn::gtk::fieldText(*field) == "a");
  }
}

TEST_CASE("a new selection prop applies to the text held with it") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    auto props = [multiline](dynamic extra) {
      extra["multiline"] = multiline;
      return textInputProps(std::move(extra));
    };
    auto input = MountedViews::shadow(2, "TextInput", props(dynamic::object("text", "a")), {{10, 10}, {150, 80}});
    views.add(input);
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    g_signal_emit_by_name(field->text, "preedit-changed", "ka");
    views.update(input, props(dynamic::object("text", "abcd")("selection", dynamic::object("start", 1)("end", 3))));
    g_signal_emit_by_name(field->text, "preedit-changed", "");
    settle();
    CHECK(ngn::gtk::fieldText(*field) == "abcd");
    CHECK(selectionOf(*field) == std::make_pair(1, 3));
  }
}

TEST_CASE("a selection-only command replaces the range held with a text") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool multiline : {false, true}) {
    CAPTURE(multiline);
    MountedViews views;
    auto input = MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("multiline", multiline)("text", "a")), {{10, 10}, {150, 80}});
    views.add(input);
    auto *field = ngn::gtk::viewData(views.view(2))->field;
    g_signal_emit_by_name(field->text, "preedit-changed", "ka");
    views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(0, "abcdefg", 1, 3));
    views.backend->dispatchCommand(2, "setTextAndSelection", dynamic::array(0, nullptr, 4, 5));
    g_signal_emit_by_name(field->text, "preedit-changed", "");
    settle();
    CHECK(ngn::gtk::fieldText(*field) == "abcdefg");
    CHECK(selectionOf(*field) == std::make_pair(4, 5));
  }
}

TEST_CASE("a multiline placeholder is aligned as the typed text is") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic props = dynamic::object("multiline", true)("placeholder", "MM")("placeholderTextColor", 0xffff0000)("textAlign", "center");
  views.add(MountedViews::shadow(2, "TextInput", textInputProps(props), {{0, 0}, {200, 40}}));
  int left = 0, middle = 0;
  for (int x = 2; x < 198; x += 2) {
    for (int y : {8, 12, 16, 20}) {
      auto p = views.pixel(x, y);
      if (p.a > 100 && p.r > 150 && p.g < 100) {
        (x < 70 ? left : middle) += 1;
      }
    }
  }
  CHECK(middle > 0);
  CHECK(left == 0);
}

TEST_CASE("explicit left alignment keeps a right-to-left paragraph on the left") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic props = dynamic::object("multiline", true)("textAlign", "left")("text", "\xD7\xA9\xD7\x9C\xD7\x95\xD7\x9D");
  views.add(MountedViews::shadow(2, "TextInput", textInputProps(props), {{0, 0}, {200, 40}}));
  auto *field = ngn::gtk::viewData(views.view(2))->field;
  GtkTextIter start;
  gtk_text_buffer_get_start_iter(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text)), &start);
  GdkRectangle at;
  gtk_text_view_get_iter_location(GTK_TEXT_VIEW(field->text), &start, &at);
  CHECK(at.x < 100);
}
