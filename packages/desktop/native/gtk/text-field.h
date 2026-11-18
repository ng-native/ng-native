// A single-line `<text-input>` on GTK: a GtkText inside the view, which paints the field's border
// and background itself, under it. React Native's iOS TextInput props and TextInputEventEmitter,
// unchanged: GTK's character offsets become React Native's UTF-16 units on the way out and back.
#pragma once

#include "view-widget.h"

#include <folly/dynamic.h>

#include <gtk/gtk.h>

#include <string>

namespace ngn::gtk {

struct TextField {
  GtkWidget *text{nullptr};
  ViewData *view{nullptr};
  // How many changes the user made, which a controlled value from JavaScript must have seen.
  int eventCount{0};
  // A change the backend made, which JavaScript already knows of.
  bool settingText{false};
};

// The UTF-16 length of the first `characters` characters of `utf8`.
int utf16Units(const std::string &utf8, int characters);
// The characters in the first `units` UTF-16 units of `utf8`.
int charactersIn(const std::string &utf8, int units);

// Makes `view`'s field, child of `widget`, from its props.
void makeTextField(GtkWidget *widget, ViewData &view);
void destroyTextField(ViewData &view);
// The field whose GtkText `widget` is, or null.
TextField *textFieldOf(GtkWidget *widget);
// Applies `view.props` to its field.
void applyTextFieldProps(ViewData &view);
// Places the field in the view's content box, centred down it.
void allocateTextField(ViewData &view, int width, int height);
// focus, blur and setTextAndSelection.
void textFieldCommand(ViewData &view, const std::string &name, const folly::dynamic &args);

} // namespace ngn::gtk
