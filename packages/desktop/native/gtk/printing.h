// Printing on GTK (ngn/printing.h). A window's content and an image go through GtkPrintOperation,
// whose dialog is the Print portal's inside a sandbox, drawn onto one page scaled to fit it. A PDF
// goes to the Print portal (PreparePrint, then Print with the file), which takes the file as it is;
// where no portal answers, to GTK's print dialog and a printer that takes PDF. HTML is absent: the
// host has no web engine. File > Print with no print item of the app's prints the window
// (MenuHost::printWindow).
#pragma once

#include "ngn/printing.h"

#include <gtk/gtk.h>

#include <functional>
#include <memory>
#include <string>

namespace ngn::gtk {

using PrintDone = std::function<void(const std::string &error)>;

// The print dialog for what `widget` (a surface) draws, on its window. Answers on the main
// context, empty once the dialog has closed, printed or cancelled.
void printWidget(GtkWidget *widget, bool landscape, PrintDone done);

// `surfaceWidget` names the widget a surface draws in, null for none.
std::shared_ptr<PrintSystem> makePrintSystem(std::function<GtkWidget *(facebook::react::SurfaceId)> surfaceWidget);

// What printWidget and an image print draw, written to a PDF at `path` with no dialog: one page of
// US Letter (A4 in a locale that uses it), the content scaled to fit inside its margins. For the
// tests, which cannot press Print.
bool exportWidget(GtkWidget *widget, bool landscape, const std::string &path);
bool exportImage(const std::string &bytes, bool landscape, const std::string &path);

} // namespace ngn::gtk
