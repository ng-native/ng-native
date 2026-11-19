// A dev or test run's input script (ngn/input-script.h) on GTK. GDK has no public way to make an
// event, so under X11 each step is posted to the X server through the XTest extension, at the
// window's own points: it reaches GTK as a person's input would, native controls included.
// libXtst is opened at run time, so a host without it, or one under Wayland, plays nothing and
// says why. The pointer steps (move, down, drag, up, secondary), key and type play; scroll,
// magnify, rotate and choose are AppKit's and are refused when the script is read.
#pragma once

#include "ngn/input-script.h"

#include <gtk/gtk.h>

#include <functional>
#include <optional>
#include <string>

// Xlib's Display, without its header.
struct _XDisplay;

namespace ngn::gtk {

// Why the script cannot play here, or nothing when it can.
std::optional<std::string> inputReplayProblem(GtkWidget *window, const InputScript &script);

#ifdef GDK_WINDOWING_X11
// Why XTest cannot post to this X connection: libXtst missing, or the server without the extension.
std::optional<std::string> xtestProblem(_XDisplay *display);
#endif

// Plays the script into `window` from now, a step at a time on the main loop, and logs
// "[ngn] input script done" after the last, then calls `done`, which a script whose window
// closes first never reaches. False, having logged why, when it cannot play.
bool replayInputScript(GtkWidget *window, InputScript script, std::function<void()> done = {});

} // namespace ngn::gtk
