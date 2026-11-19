// A Paragraph's text through GTK's GtkAccessibleText, so a screen reader reads it by character,
// word, sentence, line and paragraph (AT-SPI's Text interface). GTK has it from 4.14, past the 4.10
// floor the host builds against, so the interface is found and added at run time: below 4.14 a
// Paragraph is read by its name alone, as before. A text input's field is GTK's own GtkText or
// GtkTextView, which implement it themselves from 4.14.
#pragma once

#include <gtk/gtk.h>

#include <string>

namespace ngn::gtk {

// GTK 4.14's GtkAccessibleTextInterface, which the headers the host builds against may lack: its
// first members, in their order. GTK fills the rest with its defaults.
struct AccessibleTextInterface {
  GTypeInterface g_iface;
  GBytes *(*get_contents)(GtkAccessible *self, unsigned int start, unsigned int end);
  // `granularity` is GtkAccessibleTextGranularity: character, word, sentence, line, paragraph.
  GBytes *(*get_contents_at)(GtkAccessible *self, unsigned int offset, int granularity, unsigned int *start, unsigned int *end);
};

// GtkAccessibleText's type, or 0 below GTK 4.14.
GType accessibleTextType();

// Adds GtkAccessibleText to `type`, a view type whose widgets draw a Paragraph, when GTK has it.
void implementAccessibleText(GType type);

// Tells a screen reader that a Paragraph's text went from `before` to `after`, as GTK's own labels
// do. Nothing below GTK 4.14, or for a widget without the interface.
void accessibleTextChanged(GtkWidget *widget, const std::string &before, const std::string &after);

} // namespace ngn::gtk
