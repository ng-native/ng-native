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

// GTK 4.14's default callbacks leave the name and value arrays NULL, which its AT-SPI handler then
// indexes, so a screen reader asking for attributes would crash the host. A Paragraph has none:
// empty, NULL-terminated arrays.
gboolean getAttributes(GtkAccessible *, unsigned int, gsize *n_ranges, gpointer *ranges, char ***names, char ***values) {
  *n_ranges = 0;
  *ranges = nullptr;
  *names = g_new0(char *, 1);
  *values = g_new0(char *, 1);
  return FALSE;
}

void getDefaultAttributes(GtkAccessible *, char ***names, char ***values) {
  *names = g_new0(char *, 1);
  *values = g_new0(char *, 1);
}

void interfaceInit(gpointer vtable, gpointer) {
  fillAccessibleTextInterface(static_cast<AccessibleTextInterface *>(vtable));
}

AccessibleTextUpdate &testUpdate() {
  static AccessibleTextUpdate update = nullptr;
  return update;
}

// The change to tell, or nothing when there is no one to tell.
void tellChange(GtkWidget *widget, int change, const std::string &text) {
  using Update = void (*)(GtkAccessible *, int, unsigned int, unsigned int);
  static auto gtkUpdate = reinterpret_cast<Update>(dlsym(RTLD_DEFAULT, "gtk_accessible_text_update_contents"));
  Update update = testUpdate() ? testUpdate() : gtkUpdate;
  GType type = accessibleTextType();
  bool has = testUpdate() || (type && widget && G_TYPE_CHECK_INSTANCE_TYPE(widget, type));
  if (!update || !has || !widget || text.empty()) {
    return;
  }
  update(GTK_ACCESSIBLE(widget), change, 0, static_cast<unsigned int>(g_utf8_strlen(text.c_str(), -1)));
}

} // namespace

void fillAccessibleTextInterface(AccessibleTextInterface *iface) {
  iface->get_contents = getContents;
  iface->get_contents_at = getContentsAt;
  iface->get_attributes = getAttributes;
  iface->get_default_attributes = getDefaultAttributes;
}

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

// GtkAccessibleTextContentChange.
void accessibleTextRemoved(GtkWidget *widget, const std::string &text) {
  tellChange(widget, 1, text);
}

void accessibleTextInserted(GtkWidget *widget, const std::string &text) {
  tellChange(widget, 0, text);
}

void setAccessibleTextUpdate(AccessibleTextUpdate update) {
  testUpdate() = update;
}

} // namespace ngn::gtk
