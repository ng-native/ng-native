#include "accessible-text.h"

#include "view-widget.h"

#include "ngn/text-units.h"

#include <dlfcn.h>

#include <algorithm>

namespace ngn::gtk {

namespace {

// The text a Paragraph's widget draws, laid out as it draws it, or nothing for another widget.
PangoLayout *layoutOf(GtkAccessible *self) {
  ViewData *d = viewData(GTK_WIDGET(self));
  return d ? paragraphLayout(*d) : nullptr;
}

std::string textOf(PangoLayout *layout) {
  const char *text = layout ? pango_layout_get_text(layout) : nullptr;
  return text ? text : "";
}

// Where Pango breaks words, sentences and lines in the layout, in characters.
TextBreaks breaksOf(PangoLayout *layout) {
  TextBreaks breaks;
  int count = 0;
  const PangoLogAttr *attrs = pango_layout_get_log_attrs_readonly(layout, &count);
  for (int i = 0; i < count; i++) {
    if (attrs[i].is_word_start) {
      breaks.words.push_back(i);
    }
    if (attrs[i].is_sentence_start) {
      breaks.sentences.push_back(i);
    }
  }
  const char *text = pango_layout_get_text(layout);
  for (GSList *line = pango_layout_get_lines_readonly(layout); line; line = line->next) {
    auto *l = static_cast<PangoLayoutLine *>(line->data);
    breaks.lines.push_back(static_cast<int>(g_utf8_pointer_to_offset(text, text + l->start_index)));
  }
  return breaks;
}

// An offset GTK gives, which may be G_MAXUINT for "to the end".
int offsetOf(unsigned int offset) {
  return static_cast<int>(std::min<unsigned int>(offset, G_MAXINT));
}

// NUL-terminated, as GTK's own implementations return it.
GBytes *bytesOf(const std::string &text) {
  return g_bytes_new(text.c_str(), text.size() + 1);
}

GBytes *getContents(GtkAccessible *self, unsigned int start, unsigned int end) {
  return bytesOf(textBetween(textOf(layoutOf(self)), offsetOf(start), offsetOf(end)));
}

GBytes *getContentsAt(GtkAccessible *self, unsigned int offset, int granularity, unsigned int *start, unsigned int *end) {
  PangoLayout *layout = layoutOf(self);
  if (!layout) {
    *start = *end = 0;
    return bytesOf("");
  }
  auto text = textOf(layout);
  auto unit = static_cast<TextUnit>(std::clamp(granularity, 0, static_cast<int>(TextUnit::Paragraph)));
  auto span = textUnitAt(text, breaksOf(layout), offsetOf(offset), unit);
  *start = static_cast<unsigned int>(span.start);
  *end = static_cast<unsigned int>(span.end);
  return bytesOf(textBetween(text, span.start, span.end));
}

void interfaceInit(gpointer vtable, gpointer) {
  auto *iface = static_cast<AccessibleTextInterface *>(vtable);
  iface->get_contents = getContents;
  iface->get_contents_at = getContentsAt;
}

} // namespace

GType accessibleTextType() {
  static GType type = [] {
    using GetType = GType (*)();
    auto get = reinterpret_cast<GetType>(dlsym(RTLD_DEFAULT, "gtk_accessible_text_get_type"));
    return get ? get() : GType(0);
  }();
  return type;
}

void implementAccessibleText(GType type) {
  if (GType text = accessibleTextType()) {
    static const GInterfaceInfo info{interfaceInit, nullptr, nullptr};
    g_type_add_interface_static(type, text, &info);
  }
}

void accessibleTextChanged(GtkWidget *widget, const std::string &before, const std::string &after) {
  using Update = void (*)(GtkAccessible *, int, unsigned int, unsigned int);
  static auto update = reinterpret_cast<Update>(dlsym(RTLD_DEFAULT, "gtk_accessible_text_update_contents"));
  GType text = accessibleTextType();
  if (!update || !text || !widget || !G_TYPE_CHECK_INSTANCE_TYPE(widget, text) || before == after) {
    return;
  }
  // GtkAccessibleTextContentChange: INSERT, then REMOVE. The old text goes and the new one comes,
  // as GtkLabel reports a text set on it.
  constexpr int insert = 0, remove = 1;
  auto length = [](const std::string &s) { return static_cast<unsigned int>(g_utf8_strlen(s.c_str(), -1)); };
  if (!before.empty()) {
    update(GTK_ACCESSIBLE(widget), remove, 0, length(before));
  }
  if (!after.empty()) {
    update(GTK_ACCESSIBLE(widget), insert, 0, length(after));
  }
}

} // namespace ngn::gtk
