// Text on GTK: Pango measures what it draws, line heights included where Pango cannot set them
// (below 1.50), and a `<text-input>` is a GtkText whose changes, controlled values and selection
// cross in React Native's UTF-16 units.
#include "mounted-views.h"

#include "../pango-text.h"
#include "../text-field.h"

#include <doctest/doctest.h>

#include <react/renderer/components/textinput/TextInputEventEmitter.h>
#include <react/renderer/core/EventBeat.h>
#include <react/renderer/core/EventDispatcher.h>
#include <react/renderer/runtimescheduler/RuntimeScheduler.h>

#include <algorithm>
#include <string>
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

const std::string kWords = "one two three four five six seven eight nine ten";

// The events a view's field sends, by type, kept by a dispatcher's listener before any queue.
struct SentEvents {
  RuntimeScheduler scheduler{[](auto &&) {}};
  std::shared_ptr<EventDispatcher> dispatcher;
  std::vector<std::string> types;

  explicit SentEvents(ngn::gtk::ViewData &view) {
    EventQueueProcessor processor([](auto &&...) {}, [](auto &&...) {}, [](auto &&...) {}, {});
    dispatcher = std::make_shared<EventDispatcher>(
        processor, std::make_unique<EventBeat>(std::make_shared<EventBeat::OwnerBox>(), scheduler), [](auto &&...) {},
        std::weak_ptr<EventLogger>());
    dispatcher->addListener(std::make_shared<const EventListener>([this](const RawEvent &event) {
      types.push_back(event.type);
      return true;
    }));
    view.emitter = std::make_shared<TextInputEventEmitter>(nullptr, dispatcher);
  }

  long count(const std::string &type) const {
    return std::count(types.begin(), types.end(), type);
  }
};

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
    while (g_main_context_iteration(nullptr, false)) {
    }
    views.update(input, textInputProps(dynamic::object("multiline", multiline)("text", "d")));
    CHECK(ngn::gtk::fieldText(*field) == "d");
  }
}

TEST_CASE("a multiline text input shows its placeholder while it is empty") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic props = dynamic::object("multiline", true)("placeholder", "MMMMMMMM")("placeholderTextColor", 0xffff0000)("fontSize", 30);
  auto input = MountedViews::shadow(2, "TextInput", textInputProps(props), {{0, 0}, {200, 80}});
  views.add(input);
  auto redPixels = [&views] {
    int red = 0;
    for (int x = 2; x < 150; x += 6) {
      for (int y = 8; y < 30; y += 4) {
        auto p = views.pixel(x, y);
        red += p.a > 100 && p.r > 150 && p.g < 100;
      }
    }
    return red;
  };
  CHECK(redPixels() > 5);
  auto *field = ngn::gtk::viewData(views.view(2))->field;
  gtk_text_buffer_insert_at_cursor(gtk_text_view_get_buffer(GTK_TEXT_VIEW(field->text)), "x", -1);
  views.settle();
  CHECK(redPixels() == 0);
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

TEST_CASE("a multiline text input sends a selection change when an edit moves its cursor, and when the user does") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("multiline", true)), {{10, 10}, {150, 80}}));
  auto *data = ngn::gtk::viewData(views.view(2));
  SentEvents sent(*data);
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
