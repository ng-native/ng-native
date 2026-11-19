#include "text-field.h"

#include "ngn/text-input.h"

#include <react/renderer/components/textinput/TextInputEventEmitter.h>

#include <algorithm>
#include <limits>

using namespace facebook::react;

namespace ngn::gtk {

namespace {

std::string fieldText(const TextField &field) {
  const char *text = gtk_editable_get_text(GTK_EDITABLE(field.text));
  return text ? text : "";
}

// Null once the field's view has gone.
std::shared_ptr<const TextInputEventEmitter> emitterOf(const TextField &field) {
  return field.view ? std::dynamic_pointer_cast<const TextInputEventEmitter>(field.view->emitter) : nullptr;
}

TextInputEventEmitter::Metrics metricsOf(const TextField &field) {
  std::string text = fieldText(field);
  int start = 0, end = 0;
  if (!gtk_editable_get_selection_bounds(GTK_EDITABLE(field.text), &start, &end)) {
    start = end = gtk_editable_get_position(GTK_EDITABLE(field.text));
  }
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
  gtk_editable_set_text(GTK_EDITABLE(field.text), text.c_str());
  field.settingText = false;
}

void changed(GtkEditable *, gpointer user) {
  auto *field = static_cast<TextField *>(user);
  if (field->settingText || !field->view) {
    return;
  }
  field->eventCount++;
  if (auto emitter = emitterOf(*field)) {
    emitter->onChange(metricsOf(*field));
  }
}

void selectionMoved(GObject *, GParamSpec *, gpointer user) {
  auto *field = static_cast<TextField *>(user);
  if (field->settingText) {
    return;
  }
  if (auto emitter = emitterOf(*field)) {
    emitter->onSelectionChange(metricsOf(*field));
  }
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

void makeTextField(GtkWidget *widget, ViewData &view) {
  auto *field = new TextField();
  field->view = &view;
  field->text = gtk_text_new();
  // Freed with the GtkText, after its last signal.
  g_object_set_data_full(G_OBJECT(field->text), "ngn-text-field", field, [](gpointer p) { delete static_cast<TextField *>(p); });
  view.field = field;
  gtk_widget_set_parent(field->text, widget);
  g_signal_connect(field->text, "changed", G_CALLBACK(changed), field);
  g_signal_connect(field->text, "notify::cursor-position", G_CALLBACK(selectionMoved), field);
  g_signal_connect(field->text, "notify::selection-bound", G_CALLBACK(selectionMoved), field);
  g_signal_connect(field->text, "activate", G_CALLBACK(activated), field);
  GtkEventController *focus = gtk_event_controller_focus_new();
  g_signal_connect(focus, "enter", G_CALLBACK(focused), field);
  g_signal_connect(focus, "leave", G_CALLBACK(unfocused), field);
  gtk_widget_add_controller(field->text, focus);
  GtkEventController *keys = gtk_event_controller_key_new();
  gtk_event_controller_set_propagation_phase(keys, GTK_PHASE_CAPTURE);
  g_signal_connect(keys, "key-pressed", G_CALLBACK(keyPressed), field);
  gtk_widget_add_controller(field->text, keys);
  if (auto props = propsOf(view); props && props->text.empty() && !props->defaultValue.empty()) {
    setText(*field, props->defaultValue);
  }
  applyTextFieldProps(view);
}

TextField *textFieldOf(GtkWidget *widget) {
  return static_cast<TextField *>(g_object_get_data(G_OBJECT(widget), "ngn-text-field"));
}

void destroyTextField(ViewData &view) {
  if (view.field) {
    // The GtkText may still signal as it goes (its focus leaving): the field hears nothing more.
    view.field->view = nullptr;
    view.field = nullptr;
  }
}

void applyTextFieldProps(ViewData &view) {
  auto props = propsOf(view);
  if (!props || !view.field) {
    return;
  }
  TextField &field = *view.field;
  GtkText *text = GTK_TEXT(field.text);
  gtk_text_set_placeholder_text(text, props->placeholder.c_str());
  auto attributes = props->getEffectiveTextAttributes(1);
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
  gtk_text_set_attributes(text, list);
  pango_attr_list_unref(list);
  gtk_editable_set_editable(GTK_EDITABLE(text), props->traits.editable && props->editable && !props->readOnly);
  gtk_text_set_visibility(text, !props->traits.secureTextEntry);
  gtk_text_set_max_length(text, props->maxLength == std::numeric_limits<int>::max() ? 0 : std::max(0, props->maxLength));
  float xalign = 0;
  bool rightToLeft = view.layout.layoutDirection == LayoutDirection::RightToLeft;
  switch (attributes.alignment.value_or(TextAlignment::Natural)) {
    case TextAlignment::Center: xalign = 0.5f; break;
    case TextAlignment::Right: xalign = 1; break;
    case TextAlignment::Left: xalign = 0; break;
    default: xalign = rightToLeft ? 1 : 0; break;
  }
  gtk_editable_set_alignment(GTK_EDITABLE(text), xalign);
  gtk_widget_set_direction(field.text, rightToLeft ? GTK_TEXT_DIR_RTL : GTK_TEXT_DIR_LTR);
  // A controlled value JavaScript set, when it has seen every change the user made. Once per props:
  // a layout update applies the same props again, which must not undo a setTextAndSelection.
  if (field.controlledFrom != view.props && props->mostRecentEventCount >= field.eventCount &&
      props->text != fieldText(field) && (!props->text.empty() || props->defaultValue.empty() || field.eventCount > 0)) {
    setText(field, props->text);
  }
  field.controlledFrom = view.props;
}

void allocateTextField(ViewData &view, int width, int height) {
  GtkWidget *text = view.field->text;
  const auto &insets = view.layout.contentInsets;
  int cw = std::max(0, static_cast<int>(width - insets.left - insets.right));
  int ch = std::max(0, static_cast<int>(height - insets.top - insets.bottom));
  int minH = 0, natH = 0;
  gtk_widget_measure(text, GTK_ORIENTATION_VERTICAL, cw, &minH, &natH, nullptr, nullptr);
  int h = std::min(ch, std::max(minH, natH));
  int minW = 0;
  gtk_widget_measure(text, GTK_ORIENTATION_HORIZONTAL, h, &minW, nullptr, nullptr, nullptr);
  GtkAllocation all{static_cast<int>(insets.left), static_cast<int>(insets.top) + (ch - h) / 2, std::max(cw, minW), h};
  gtk_widget_size_allocate(text, &all, -1);
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
    // [mostRecentEventCount, value, start, end]: a value only when JavaScript has seen every change.
    // The count is a JavaScript number, which can arrive as a double.
    if (args[0].isNumber() && args[0].asDouble() < field.eventCount) {
      return;
    }
    if (args[1].isString()) {
      setText(field, args[1].getString());
    }
    if (args[2].isNumber() && args[3].isNumber()) {
      std::string text = fieldText(field);
      int start = charactersIn(text, static_cast<int>(args[2].asDouble()));
      int end = charactersIn(text, static_cast<int>(args[3].asDouble()));
      field.settingText = true;
      gtk_editable_select_region(GTK_EDITABLE(field.text), start, end);
      field.settingText = false;
    }
  }
}

} // namespace ngn::gtk
