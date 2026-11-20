// Alerts on GTK (System::showAlert, behind Alert.alert, Alert.prompt and Dialogs): an AdwAlertDialog
// in the active window on libadwaita 1.5 and later, found at run time since the build targets 1.4's
// API, and otherwise an AdwMessageDialog, a modal window of its own, which also shows when no window
// is active, so the answer always arrives. Both take the prompt's text fields. The buttons follow
// GNOME's order (gnomeAlertLayout): Cancel first and on Escape, the affirmative last and on Return
// unless destructive.
#pragma once

#include "ngn/system.h"

#include <gtk/gtk.h>

#include <functional>
#include <string>

namespace ngn::gtk {

// Shows `request` over `parent`, or on its own with none; `done` gets the button's index (the
// request's), the text and the password. On the GTK thread.
void showAlert(const AlertRequest &request, std::function<void(int, std::string, std::string)> done, GtkWindow *parent);

// The application's active window, which an alert shows over; null for none.
GtkWindow *activeWindow();

// The alert showing last, for tests: the dialog, and how it answers a response id ("b<index>", or
// "close" for Escape). Null for none.
GtkWidget *shownAlert();
void respondToAlert(GtkWidget *alert, const char *response);

} // namespace ngn::gtk
