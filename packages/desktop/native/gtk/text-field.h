// A `<text-input>` on GTK: a GtkText for a single line, a GtkTextView in a GtkScrolledWindow for
// `multiline`, inside the view, which paints the field's border and background itself, under it.
// React Native's iOS TextInput props and TextInputEventEmitter, unchanged: GTK's character offsets
// become React Native's UTF-16 units on the way out and back. Each has its own input method
// context; while it composes, a controlled value waits, as on macOS (text-input.h).
#pragma once

#include "view-widget.h"

#include <react/renderer/core/Props.h>

#include <folly/dynamic.h>

#include <gtk/gtk.h>

#include <string>

namespace ngn::gtk {

struct TextField {
  // The GtkText, or the GtkTextView of a multiline field.
  GtkWidget *text{nullptr};
  // A multiline field's scrolled window, which holds its GtkTextView.
  GtkWidget *scroll{nullptr};
  ViewData *view{nullptr};
  // How many changes the user made, which a controlled value from JavaScript must have seen.
  int eventCount{0};
  // A change the backend made, which JavaScript already knows of.
  bool settingText{false};
  // Whether an input method is composing: its preedit text is not yet the field's.
  bool composing{false};
  // The props last applied, against which a `selection` prop is new. The same props again (a
  // layout update) never put their controlled value back over a setTextAndSelection.
  facebook::react::Props::Shared applied;
};

// The UTF-16 length of the first `characters` characters of `utf8`.
int utf16Units(const std::string &utf8, int characters);
// The characters in the first `units` UTF-16 units of `utf8`.
int charactersIn(const std::string &utf8, int units);

// Makes `view`'s field, child of `widget`, from its props: multiline or not, which a view keeps.
void makeTextField(GtkWidget *widget, ViewData &view);
void destroyTextField(ViewData &view);
// The field whose GtkText or GtkTextView `widget` is, or null.
TextField *textFieldOf(GtkWidget *widget);
// The field's child of its view: its scrolled window when multiline, else its GtkText.
GtkWidget *fieldWidget(const TextField &field);
// The field's text, as JavaScript reads it.
std::string fieldText(const TextField &field);
// Applies `view.props` to its field.
void applyTextFieldProps(ViewData &view);
// Places the field in the view's content box: a single line centred down it, many filling it.
void allocateTextField(ViewData &view, int width, int height);
// A multiline field's placeholder, while it is empty: GtkTextView has none of its own.
void snapshotPlaceholder(const ViewData &view, GtkSnapshot *snapshot);
// focus, blur and setTextAndSelection.
void textFieldCommand(ViewData &view, const std::string &name, const folly::dynamic &args);

} // namespace ngn::gtk
