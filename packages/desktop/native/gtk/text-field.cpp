#include "text-field.h"

#include "ngn/text-input.h"

#include <react/renderer/components/textinput/TextInputEventEmitter.h>

#include <algorithm>
#include <cstring>
#include <limits>

using namespace facebook::react;

namespace ngn::gtk {

namespace {

bool multiline(const TextField &field) {
  return field.scroll != nullptr;
}

GtkTextBuffer *bufferOf(const TextField &field) {
  return gtk_text_view_get_buffer(GTK_TEXT_VIEW(field.text));
}

// The selection in characters, the cursor alone as an empty one.
std::pair<int, int> selectionOf(const TextField &field) {
  int start = 0, end = 0;
  if (multiline(field)) {
    GtkTextIter a, b;
    gtk_text_buffer_get_selection_bounds(bufferOf(field), &a, &b);
    start = gtk_text_iter_get_offset(&a);
    end = gtk_text_iter_get_offset(&b);
  } else if (!gtk_editable_get_selection_bounds(GTK_EDITABLE(field.text), &start, &end)) {
    start = end = gtk_editable_get_position(GTK_EDITABLE(field.text));
  }
  return {std::min(start, end), std::max(start, end)};
}

// Null once the field's view has gone.
std::shared_ptr<const TextInputEventEmitter> emitterOf(const TextField &field) {
  return field.view ? std::dynamic_pointer_cast<const TextInputEventEmitter>(field.view->emitter) : nullptr;
}

TextInputEventEmitter::Metrics metricsOf(const TextField &field) {
  std::string text = fieldText(field);
  auto [start, end] = selectionOf(field);
  int from = utf16Units(text, start);
  int to = utf16Units(text, end);
  TextInputEventEmitter::Metrics m{};
  m.text = text;
  m.selectionRange = {.location = from, .length = to - from};
  m.eventCount = field.eventCount;
  m.target = field.view->tag;
  return m;
}

void setText(TextField &field, const std::string &text) {
  field.settingText = true;
  if (multiline(field)) {
    gtk_text_buffer_set_text(bufferOf(field), text.c_str(), static_cast<int>(text.size()));
  } else {
    gtk_editable_set_text(GTK_EDITABLE(field.text), text.c_str());
  }
  field.settingText = false;
}

// Selects characters `start` to `end`, the cursor at the end.
void select(TextField &field, int start, int end) {
  field.settingText = true;
  if (multiline(field)) {
    GtkTextIter a, b;
    gtk_text_buffer_get_iter_at_offset(bufferOf(field), &a, start);
    gtk_text_buffer_get_iter_at_offset(bufferOf(field), &b, end);
    gtk_text_buffer_select_range(bufferOf(field), &b, &a);
  } else {
    gtk_editable_select_region(GTK_EDITABLE(field.text), start, end);
  }
  field.settingText = false;
}

// Selects UTF-16 units `start` to `end` of the field's text.
void selectUnits(TextField &field, int start, int end) {
  std::string text = fieldText(field);
  select(field, charactersIn(text, start), charactersIn(text, end));
}

void changed(TextField *field) {
  if (field->settingText || !field->view) {
    return;
  }
  field->eventCount++;
  if (auto emitter = emitterOf(*field)) {
    emitter->onChange(metricsOf(*field));
  }
}

void selectionMoved(TextField *field) {
  if (field->settingText || !field->view) {
    return;
  }
  if (auto emitter = emitterOf(*field)) {
    emitter->onSelectionChange(metricsOf(*field));
  }
}

// A multiline field's placeholder shows or goes with its text and its composition.
void redrawPlaceholder(const TextField &field) {
  if (field.scroll && field.view && field.view->widget) {
    gtk_widget_queue_draw(field.view->widget);
  }
}

void cancelPendingApply(TextField &field) {
  if (field.applyPendingSource) {
    g_source_remove(field.applyPendingSource);
    field.applyPendingSource = 0;
  }
}

// Applies the held controlled value, unless the user changed the text since it was captured.
gboolean applyPendingText(gpointer user) {
  auto *field = static_cast<TextField *>(user);
  field->applyPendingSource = 0;
  if (!field->pendingText || field->composing) {
    return G_SOURCE_REMOVE;
  }
  auto pending = std::move(*field->pendingText);
  field->pendingText.reset();
  if (field->view && pending.seen >= field->eventCount) {
    if (pending.text != fieldText(*field)) {
      setText(*field, pending.text);
    }
    if (pending.selection) {
      selectUnits(*field, pending.selection->first, pending.selection->second);
    }
  }
  return G_SOURCE_REMOVE;
}

void preeditChanged(GtkWidget *, const char *preedit, gpointer user) {
  auto *field = static_cast<TextField *>(user);
  field->composing = preedit && *preedit;
  if (field->composing) {
    cancelPendingApply(*field);
  } else if (field->pendingText && !field->applyPendingSource) {
    // An input method sends an empty preedit and then commits what was composed: apply the held
    // value after the commit, which counts as a user change that makes it stale.
    field->applyPendingSource = g_idle_add(applyPendingText, field);
  }
  redrawPlaceholder(*field);
}

void activated(GtkText *, gpointer user) {
  auto *field = static_cast<TextField *>(user);
  if (auto emitter = emitterOf(*field)) {
    emitter->onSubmitEditing(metricsOf(*field));
  }
}

void focused(GtkEventControllerFocus *, gpointer user) {
  auto *field = static_cast<TextField *>(user);
  if (auto emitter = emitterOf(*field)) {
    emitter->onFocus(metricsOf(*field));
  }
}

void unfocused(GtkEventControllerFocus *, gpointer user) {
  auto *field = static_cast<TextField *>(user);
  if (auto emitter = emitterOf(*field)) {
    auto metrics = metricsOf(*field);
    emitter->onEndEditing(metrics);
    emitter->onBlur(metrics);
  }
}

// `onKeyPress`, before the key changes the text, with the key as React Native iOS names it.
gboolean keyPressed(GtkEventControllerKey *, guint keyval, guint, GdkModifierType state, gpointer user) {
  auto *field = static_cast<TextField *>(user);
  if (state & (GDK_CONTROL_MASK | GDK_ALT_MASK | GDK_SUPER_MASK)) {
    return FALSE;
  }
  std::string key;
  if (keyval == GDK_KEY_BackSpace) {
    key = "Backspace";
  } else if (keyval == GDK_KEY_Return || keyval == GDK_KEY_KP_Enter) {
    key = "Enter";
  } else if (gunichar c = gdk_keyval_to_unicode(keyval); c != 0 && g_unichar_isprint(c)) {
    char utf8[8] = {};
    g_unichar_to_utf8(c, utf8);
    key = utf8;
  }
  if (!key.empty()) {
    if (auto emitter = emitterOf(*field)) {
      emitter->onKeyPress({.text = key, .eventCount = field->eventCount});
    }
  }
  return FALSE;
}

std::shared_ptr<const DesktopTextInputProps> propsOf(const ViewData &view) {
  return std::dynamic_pointer_cast<const DesktopTextInputProps>(view.props);
}

// A multiline field keeps to `maxLength` in UTF-16 units, as a single line's GtkText keeps to its
// own: what does not fit of an insertion is left out, never inside a character.
void insertingText(GtkTextBuffer *buffer, GtkTextIter *at, const char *text, int length, gpointer user) {
  auto *field = static_cast<TextField *>(user);
  auto props = field->view ? propsOf(*field->view) : nullptr;
  if (field->settingText || !props || props->maxLength == std::numeric_limits<int>::max()) {
    return;
  }
  std::string inserted(text, length < 0 ? strlen(text) : static_cast<size_t>(length));
  std::string current = fieldText(*field);
  auto units = [](const std::string &s) { return static_cast<size_t>(utf16Units(s, static_cast<int>(g_utf8_strlen(s.c_str(), -1)))); };
  size_t fits = insertionThatFits(units(current), 0, units(inserted), static_cast<size_t>(std::max(0, props->maxLength)));
  if (fits >= units(inserted)) {
    return;
  }
  g_signal_stop_emission_by_name(buffer, "insert-text");
  std::string part = inserted.substr(0, g_utf8_offset_to_pointer(inserted.c_str(), charactersIn(inserted, static_cast<int>(fits))) - inserted.c_str());
  if (!part.empty()) {
    g_signal_handlers_block_by_func(buffer, reinterpret_cast<gpointer>(insertingText), user);
    gtk_text_buffer_insert(buffer, at, part.c_str(), static_cast<int>(part.size()));
    g_signal_handlers_unblock_by_func(buffer, reinterpret_cast<gpointer>(insertingText), user);
  }
}

// The run of text attributes a TextInput's text takes: its font and colour.
PangoAttrList *textAttributes(const DesktopTextInputProps &props) {
  auto attributes = props.getEffectiveTextAttributes(1);
  PangoAttrList *list = pango_attr_list_new();
  PangoFontDescription *font = fontOf(attributes);
  pango_attr_list_insert(list, pango_attr_font_desc_new(font));
  pango_font_description_free(font);
  if (attributes.foregroundColor) {
    auto c = colorComponentsFromColor(attributes.foregroundColor);
    auto channel = [](float v) { return static_cast<guint16>(std::clamp(v, 0.0f, 1.0f) * 65535); };
    pango_attr_list_insert(list, pango_attr_foreground_new(channel(c.red), channel(c.green), channel(c.blue)));
    pango_attr_list_insert(list, pango_attr_foreground_alpha_new(channel(c.alpha)));
  }
  return list;
}

// -1 when the first letter of `text` is of a right-to-left script, 1 when of any other, 0 with none.
int firstStrongDirection(const char *text) {
  for (const char *p = text; *p; p = g_utf8_next_char(p)) {
    gunichar c = g_utf8_get_char(p);
    if (!g_unichar_isalpha(c)) {
      continue;
    }
    switch (g_unichar_get_script(c)) {
      case G_UNICODE_SCRIPT_HEBREW:
      case G_UNICODE_SCRIPT_ARABIC:
      case G_UNICODE_SCRIPT_SYRIAC:
      case G_UNICODE_SCRIPT_THAANA:
      case G_UNICODE_SCRIPT_NKO:
      case G_UNICODE_SCRIPT_SAMARITAN:
      case G_UNICODE_SCRIPT_MANDAIC:
        return -1;
      default: return 1;
    }
  }
  return 0;
}

// GTK resolves a left or right justification against each paragraph's own direction, but an
// explicit left or right is physical. A paragraph whose strong direction differs from the field's
// takes the opposite justification, on a tag over it.
void alignParagraphs(TextField &field) {
  GtkTextBuffer *buffer = bufferOf(field);
  GtkTextTag *tag = gtk_text_tag_table_lookup(gtk_text_buffer_get_tag_table(buffer), "ngn-flip");
  if (!tag) {
    tag = gtk_text_buffer_create_tag(buffer, "ngn-flip", nullptr);
  }
  GtkTextIter start, end;
  gtk_text_buffer_get_bounds(buffer, &start, &end);
  gtk_text_buffer_remove_tag(buffer, tag, &start, &end);
  GtkJustification justification = gtk_text_view_get_justification(GTK_TEXT_VIEW(field.text));
  if (justification != GTK_JUSTIFY_LEFT && justification != GTK_JUSTIFY_RIGHT) {
    return;
  }
  g_object_set(tag, "justification", justification == GTK_JUSTIFY_LEFT ? GTK_JUSTIFY_RIGHT : GTK_JUSTIFY_LEFT, nullptr);
  bool fieldRtl = gtk_widget_get_direction(field.text) == GTK_TEXT_DIR_RTL;
  GtkTextIter line = start;
  do {
    GtkTextIter lineEnd = line;
    if (!gtk_text_iter_ends_line(&lineEnd)) {
      gtk_text_iter_forward_to_line_end(&lineEnd);
    }
    gchar *text = gtk_text_iter_get_slice(&line, &lineEnd);
    int direction = firstStrongDirection(text);
    g_free(text);
    if (direction != 0 && (direction < 0) != fieldRtl) {
      gtk_text_buffer_apply_tag(buffer, tag, &line, &lineEnd);
    }
  } while (gtk_text_iter_forward_line(&line));
}

// A multiline field's font and colour, on a tag over all of its text.
void styleTextView(TextField &field, const DesktopTextInputProps &props) {
  GtkTextBuffer *buffer = bufferOf(field);
  GtkTextTag *tag = gtk_text_tag_table_lookup(gtk_text_buffer_get_tag_table(buffer), "ngn-text");
  if (!tag) {
    tag = gtk_text_buffer_create_tag(buffer, "ngn-text", nullptr);
  }
  auto attributes = props.getEffectiveTextAttributes(1);
  PangoFontDescription *font = fontOf(attributes);
  g_object_set(tag, "font-desc", font, nullptr);
  pango_font_description_free(font);
  if (attributes.foregroundColor) {
    auto c = colorComponentsFromColor(attributes.foregroundColor);
    GdkRGBA rgba{c.red, c.green, c.blue, c.alpha};
    g_object_set(tag, "foreground-rgba", &rgba, nullptr);
  }
  GtkTextIter start, end;
  gtk_text_buffer_get_bounds(buffer, &start, &end);
  gtk_text_buffer_apply_tag(buffer, tag, &start, &end);
  alignParagraphs(field);
}

void restyle(GtkTextBuffer *, gpointer user) {
  auto *field = static_cast<TextField *>(user);
  if (auto props = field->view ? propsOf(*field->view) : nullptr) {
    styleTextView(*field, *props);
  }
  redrawPlaceholder(*field);
}

// A multiline field's text view and scrolled window draw no background of their own: the view
// paints the field's.
void plainTextViews() {
  static bool installed = false;
  if (installed || !gdk_display_get_default()) {
    return;
  }
  installed = true;
  GtkCssProvider *css = gtk_css_provider_new();
  gtk_css_provider_load_from_data(css, "textview.ngn-plain, textview.ngn-plain > text { background: none; }", -1);
  gtk_style_context_add_provider_for_display(gdk_display_get_default(), GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
  g_object_unref(css);
}

void watch(TextField *field, GtkWidget *editor) {
  g_object_set_data(G_OBJECT(editor), "ngn-text-field", field);
  g_signal_connect(editor, "preedit-changed", G_CALLBACK(preeditChanged), field);
  GtkEventController *focus = gtk_event_controller_focus_new();
  g_signal_connect(focus, "enter", G_CALLBACK(focused), field);
  g_signal_connect(focus, "leave", G_CALLBACK(unfocused), field);
  gtk_widget_add_controller(editor, focus);
  GtkEventController *keys = gtk_event_controller_key_new();
  gtk_event_controller_set_propagation_phase(keys, GTK_PHASE_CAPTURE);
  g_signal_connect(keys, "key-pressed", G_CALLBACK(keyPressed), field);
  gtk_widget_add_controller(editor, keys);
}

} // namespace

int utf16Units(const std::string &utf8, int characters) {
  int units = 0;
  const char *p = utf8.c_str();
  const char *end = p + utf8.size();
  for (int i = 0; i < characters && p < end; ++i) {
    gunichar c = g_utf8_get_char(p);
    units += c > 0xFFFF ? 2 : 1;
    p = g_utf8_next_char(p);
  }
  return units;
}

int charactersIn(const std::string &utf8, int units) {
  int characters = 0;
  const char *p = utf8.c_str();
  const char *end = p + utf8.size();
  while (units > 0 && p < end) {
    gunichar c = g_utf8_get_char(p);
    units -= c > 0xFFFF ? 2 : 1;
    // A unit count that falls inside a surrogate pair keeps the whole character before it.
    if (units < 0) {
      break;
    }
    ++characters;
    p = g_utf8_next_char(p);
  }
  return characters;
}

std::string fieldText(const TextField &field) {
  if (multiline(field)) {
    GtkTextIter start, end;
    gtk_text_buffer_get_bounds(bufferOf(field), &start, &end);
    gchar *text = gtk_text_buffer_get_text(bufferOf(field), &start, &end, FALSE);
    std::string out = text ? text : "";
    g_free(text);
    return out;
  }
  const char *text = gtk_editable_get_text(GTK_EDITABLE(field.text));
  return text ? text : "";
}

GtkWidget *fieldWidget(const TextField &field) {
  return field.scroll ? field.scroll : field.text;
}

void makeTextField(GtkWidget *widget, ViewData &view) {
  auto *field = new TextField();
  field->view = &view;
  auto props = propsOf(view);
  if (props && props->multiline) {
    field->text = gtk_text_view_new();
    gtk_text_view_set_wrap_mode(GTK_TEXT_VIEW(field->text), GTK_WRAP_WORD_CHAR);
    // The view's border and background are the field's: the text view draws neither.
    plainTextViews();
    gtk_widget_add_css_class(field->text, "ngn-plain");
    field->scroll = gtk_scrolled_window_new();
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(field->scroll), GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    gtk_scrolled_window_set_child(GTK_SCROLLED_WINDOW(field->scroll), field->text);
    GtkTextBuffer *buffer = bufferOf(*field);
    g_signal_connect_swapped(buffer, "changed", G_CALLBACK(changed), field);
    g_signal_connect_after(buffer, "changed", G_CALLBACK(restyle), field);
    g_signal_connect(buffer, "insert-text", G_CALLBACK(insertingText), field);
    // The cursor, whether set or moved by an edit, and the selection's other end, which only a set moves.
    g_signal_connect_swapped(buffer, "notify::cursor-position", G_CALLBACK(selectionMoved), field);
    g_signal_connect(buffer, "mark-set", G_CALLBACK(+[](GtkTextBuffer *buffer, GtkTextIter *, GtkTextMark *mark, gpointer user) {
      if (mark == gtk_text_buffer_get_selection_bound(buffer)) {
        selectionMoved(static_cast<TextField *>(user));
      }
    }), field);
  } else {
    field->text = gtk_text_new();
    g_signal_connect_swapped(field->text, "changed", G_CALLBACK(changed), field);
    g_signal_connect_swapped(field->text, "notify::cursor-position", G_CALLBACK(selectionMoved), field);
    g_signal_connect_swapped(field->text, "notify::selection-bound", G_CALLBACK(selectionMoved), field);
    g_signal_connect(field->text, "activate", G_CALLBACK(activated), field);
  }
  watch(field, field->text);
  // Freed with the editor, after its last signal. A multiline field's buffer, which can outlive it
  // (a paste still to arrive), is disconnected from the field when its view goes.
  g_object_set_data_full(G_OBJECT(field->text), "ngn-text-field-owner", field, [](gpointer p) {
    auto *field = static_cast<TextField *>(p);
    cancelPendingApply(*field);
    delete field;
  });
  view.field = field;
  gtk_widget_set_parent(fieldWidget(*field), widget);
  if (props && props->text.empty() && !props->defaultValue.empty()) {
    setText(*field, props->defaultValue);
  }
  applyTextFieldProps(view);
}

TextField *textFieldOf(GtkWidget *widget) {
  return static_cast<TextField *>(g_object_get_data(G_OBJECT(widget), "ngn-text-field"));
}

void destroyTextField(ViewData &view) {
  if (view.field) {
    // The editor may still signal as it goes (its focus leaving): the field hears nothing more.
    view.field->view = nullptr;
    if (multiline(*view.field)) {
      g_signal_handlers_disconnect_by_data(bufferOf(*view.field), view.field);
    }
    view.field = nullptr;
  }
}

void applyTextFieldProps(ViewData &view) {
  auto props = propsOf(view);
  if (!props || !view.field) {
    return;
  }
  TextField &field = *view.field;
  auto attributes = props->getEffectiveTextAttributes(1);
  bool editable = props->traits.editable && props->editable && !props->readOnly;
  bool rightToLeft = view.layout.layoutDirection == LayoutDirection::RightToLeft;
  float xalign = 0;
  switch (attributes.alignment.value_or(TextAlignment::Natural)) {
    case TextAlignment::Center: xalign = 0.5f; break;
    case TextAlignment::Right: xalign = 1; break;
    case TextAlignment::Left: xalign = 0; break;
    default: xalign = rightToLeft ? 1 : 0; break;
  }
  gtk_widget_set_direction(field.text, rightToLeft ? GTK_TEXT_DIR_RTL : GTK_TEXT_DIR_LTR);
  if (multiline(field)) {
    GtkTextView *text = GTK_TEXT_VIEW(field.text);
    // Left in a right-to-left field is its start, so the natural alignment is GTK's left.
    gtk_text_view_set_justification(
        text, xalign == 0.5f ? GTK_JUSTIFY_CENTER : (xalign == 1) != rightToLeft ? GTK_JUSTIFY_RIGHT : GTK_JUSTIFY_LEFT);
    styleTextView(field, *props);
    gtk_text_view_set_editable(text, editable);
    gtk_text_view_set_cursor_visible(text, editable);
  } else {
    GtkText *text = GTK_TEXT(field.text);
    gtk_text_set_placeholder_text(text, props->placeholder.c_str());
    PangoAttrList *list = textAttributes(*props);
    gtk_text_set_attributes(text, list);
    pango_attr_list_unref(list);
    gtk_editable_set_editable(GTK_EDITABLE(text), editable);
    gtk_text_set_visibility(text, !props->traits.secureTextEntry);
    gtk_text_set_max_length(text, props->maxLength == std::numeric_limits<int>::max() ? 0 : std::max(0, props->maxLength));
    gtk_editable_set_alignment(GTK_EDITABLE(text), xalign);
  }
  // A controlled value JavaScript set, when it has seen every change the user made, held while an
  // input method composes. Once per props: a layout update applies the same props again, which
  // must not undo a setTextAndSelection.
  if (field.applied != view.props) {
    // Stale props, which cannot supersede a held value, leave it alone.
    if (controlledTextIsCurrent(props->mostRecentEventCount, field.eventCount, false) &&
        (!props->text.empty() || props->defaultValue.empty() || field.eventCount > 0)) {
      auto previous = std::dynamic_pointer_cast<const DesktopTextInputProps>(field.applied);
      if (field.pendingText && previous && previous->text == props->text &&
          field.pendingText->seen >= props->mostRecentEventCount) {
        // The text is the same as the props before it, which answer no newer edit: a held
        // setTextAndSelection stays.
      } else if (field.composing) {
        cancelPendingApply(field);
        field.pendingText.emplace(TextField::Pending{props->text, props->mostRecentEventCount, std::nullopt});
      } else {
        field.pendingText.reset();
        cancelPendingApply(field);
        if (props->text != fieldText(field)) {
          setText(field, props->text);
        }
      }
    }
  }
  auto before = std::dynamic_pointer_cast<const DesktopTextInputProps>(field.applied);
  if (auto range = newSelection(before.get(), *props)) {
    // Against the text it accompanies: a held text takes it when it is applied.
    if (field.pendingText) {
      field.pendingText->selection = *range;
    } else {
      selectUnits(field, range->first, range->second);
    }
  }
  field.applied = view.props;
  redrawPlaceholder(field);
}

void allocateTextField(ViewData &view, int width, int height) {
  GtkWidget *child = fieldWidget(*view.field);
  const auto &insets = view.layout.contentInsets;
  int cw = std::max(0, static_cast<int>(width - insets.left - insets.right));
  int ch = std::max(0, static_cast<int>(height - insets.top - insets.bottom));
  if (multiline(*view.field)) {
    GtkAllocation all{static_cast<int>(insets.left), static_cast<int>(insets.top), cw, ch};
    gtk_widget_size_allocate(child, &all, -1);
    return;
  }
  int minH = 0, natH = 0;
  gtk_widget_measure(child, GTK_ORIENTATION_VERTICAL, cw, &minH, &natH, nullptr, nullptr);
  int h = std::min(ch, std::max(minH, natH));
  int minW = 0;
  gtk_widget_measure(child, GTK_ORIENTATION_HORIZONTAL, h, &minW, nullptr, nullptr, nullptr);
  GtkAllocation all{static_cast<int>(insets.left), static_cast<int>(insets.top) + (ch - h) / 2, std::max(cw, minW), h};
  gtk_widget_size_allocate(child, &all, -1);
}

void snapshotPlaceholder(const ViewData &view, GtkSnapshot *snapshot) {
  const TextField *field = view.field;
  auto props = propsOf(view);
  if (!field || !multiline(*field) || !props || props->placeholder.empty() || field->composing ||
      gtk_text_buffer_get_char_count(bufferOf(*field)) > 0) {
    return;
  }
  PangoLayout *layout = gtk_widget_create_pango_layout(field->text, props->placeholder.c_str());
  PangoFontDescription *font = fontOf(props->getEffectiveTextAttributes(1));
  pango_layout_set_font_description(layout, font);
  pango_font_description_free(font);
  const auto &insets = view.layout.contentInsets;
  pango_layout_set_width(layout, static_cast<int>(std::max<Float>(0, view.layout.frame.size.width - insets.left - insets.right) * PANGO_SCALE));
  pango_layout_set_wrap(layout, PANGO_WRAP_WORD_CHAR);
  // Aligned as the typed text is.
  switch (gtk_text_view_get_justification(GTK_TEXT_VIEW(field->text))) {
    case GTK_JUSTIFY_CENTER: pango_layout_set_alignment(layout, PANGO_ALIGN_CENTER); break;
    case GTK_JUSTIFY_RIGHT: pango_layout_set_alignment(layout, PANGO_ALIGN_RIGHT); break;
    default: pango_layout_set_alignment(layout, PANGO_ALIGN_LEFT); break;
  }
  // The placeholder colour, or GTK's own dimmed text.
  GdkRGBA color{0, 0, 0, 0.5f};
  if (props->placeholderTextColor) {
    auto c = colorComponentsFromColor(props->placeholderTextColor);
    color = {c.red, c.green, c.blue, c.alpha};
  }
  // Within the content box, however many lines it wraps to.
  graphene_rect_t box;
  graphene_rect_init(&box, static_cast<float>(insets.left), static_cast<float>(insets.top),
                     static_cast<float>(std::max<Float>(0, view.layout.frame.size.width - insets.left - insets.right)),
                     static_cast<float>(std::max<Float>(0, view.layout.frame.size.height - insets.top - insets.bottom)));
  gtk_snapshot_push_clip(snapshot, &box);
  gtk_snapshot_save(snapshot);
  graphene_point_t at;
  graphene_point_init(&at, static_cast<float>(insets.left), static_cast<float>(insets.top));
  gtk_snapshot_translate(snapshot, &at);
  gtk_snapshot_append_layout(snapshot, layout, &color);
  gtk_snapshot_restore(snapshot);
  gtk_snapshot_pop(snapshot);
  g_object_unref(layout);
}

void textFieldCommand(ViewData &view, const std::string &name, const folly::dynamic &args) {
  if (!view.field) {
    return;
  }
  TextField &field = *view.field;
  if (name == "focus") {
    gtk_widget_grab_focus(field.text);
  } else if (name == "blur") {
    if (GtkRoot *root = gtk_widget_get_root(field.text); root && gtk_widget_has_focus(field.text)) {
      gtk_root_set_focus(root, nullptr);
    }
  } else if (name == "setTextAndSelection" && args.isArray() && args.size() >= 4) {
    // [mostRecentEventCount, value, start, end]: a value only when JavaScript has seen every change,
    // held while an input method composes.
    // The count is a JavaScript number, which can arrive as a double.
    if (args[0].isNumber() && args[0].asDouble() < field.eventCount) {
      return;
    }
    if (args[1].isString() && field.composing) {
      TextField::Pending pending{
          args[1].getString(), args[0].isNumber() ? static_cast<int>(args[0].asDouble()) : field.eventCount, std::nullopt};
      if (args[2].isNumber() && args[3].isNumber()) {
        pending.selection.emplace(static_cast<int>(args[2].asDouble()), static_cast<int>(args[3].asDouble()));
      }
      field.pendingText.emplace(std::move(pending));
      return;
    }
    if (args[1].isString()) {
      field.pendingText.reset();
      cancelPendingApply(field);
      setText(field, args[1].getString());
    }
    if (args[2].isNumber() && args[3].isNumber()) {
      int start = static_cast<int>(args[2].asDouble());
      int end = static_cast<int>(args[3].asDouble());
      if (field.pendingText) {
        // Newer than a range held with the text, which it is applied to.
        field.pendingText->selection.emplace(start, end);
      } else {
        selectUnits(field, start, end);
      }
    }
  }
}

} // namespace ngn::gtk
