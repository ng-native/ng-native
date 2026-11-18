// What Processes, Shell and KeepAwake reach on Linux: the spawn setup, the desktop's launchers
// through the OpenURI portal, and the idle inhibitor.
#pragma once

#include "ngn/desktop-expo.h"
#include "ngn/host-os.h"
#include "ngn/processes.h"

#include <gtk/gtk.h>

#include <functional>
#include <memory>
#include <string>

namespace ngn::gtk {

// Inside a Flatpak sandbox, which /.flatpak-info marks.
bool insideFlatpak();

// Processes' setup: the environment the app started with, `os`'s search path (with the app's own
// /app/bin first inside a Flatpak, whose spawns stay in the sandbox), and the capabilities
// declared as `capabilitiesJson`, none when that is not JSON.
ProcessesSetup processesSetup(const HostOs &os, const std::string &capabilitiesJson, bool flatpak);

// Opens `uri` in the app the desktop chose for it, through the OpenURI portal, or GTK's launcher
// where no portal answers; `done` hears whether it opened, on the main context.
void openUri(const std::string &uri, std::function<void(bool)> done);

// Shell's opener: OpenURI's OpenURI, OpenFile and OpenDirectory, with GTK's launchers where no
// portal answers. What opening a path would run is read from its content type.
std::shared_ptr<ShellOpener> makeShellOpener();

// Holds the session idle while the app is awake: GtkApplication's inhibitor, which asks the Inhibit
// portal inside a sandbox and the session manager or the compositor outside one.
std::shared_ptr<SleepPreventer> makeSleepPreventer(GtkApplication *application);

} // namespace ngn::gtk
