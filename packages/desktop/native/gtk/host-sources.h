// What the GTK host passes the core for the OS, as far as this backend reaches it yet: the System
// over GLib and libadwaita, and stand-ins for what later steps add, each of which refuses or does
// nothing rather than pretend. Networking is the core's libcurl client (curl-network.h).
#pragma once

#include "ngn/app-menus.h"
#include "ngn/app-windows.h"
#include "ngn/native-controls.h"
#include "ngn/system.h"
#include "ngn/undo.h"

#include <functional>
#include <memory>
#include <string>

namespace ngn::gtk {

// Preferences in `<appData>/preferences.ini`, the colour scheme from libadwaita's style manager,
// the display's GdkClipboard, alerts logged and cancelled until the dialogs come. GDK reads the
// clipboard asynchronously and System does not, so the system keeps its text as it changes:
// `clipboardChanged` hears the new change count once another app's text has been read, on the main
// context. With no display, the clipboard is the app's own, in memory. `colorSchemeChanged` hears
// the scheme GTK draws whenever libadwaita's dark changes: the desktop's, through the settings
// portal, or an override as it is applied; on the main context. While a later override still
// waits to apply, colorScheme() already answers that one.
std::shared_ptr<System> makeSystem(const std::string &appId, const std::string &appDataDirectory,
                                   std::function<void(int64_t count)> clipboardChanged = {},
                                   std::function<void(const std::string &scheme)> colorSchemeChanged = {});

// Whether Linking can open `uri`: one with a scheme the desktop has an app for. Inside a sandbox the
// desktop portal decides as it opens it, so any scheme can be tried there.
bool canOpenUri(const std::string &uri, bool sandboxed, const std::function<bool(const std::string &scheme)> &hasHandler);

// Strings in a key file at `path`, written on each change.
std::shared_ptr<StringStore> makeKeyFileStore(const std::string &path);

std::shared_ptr<MenuBackend> makeNoMenus();

// The app's undo history (`UndoStack`): the core's UndoStacks, which GTK has no manager of its own
// for, kept on the UI thread whichever thread asks, as AppKit's NSUndoManager is.
std::shared_ptr<UndoManager> makeUndoManager();

// How big GTK draws each native control (native-controls.h).
std::shared_ptr<ControlMeasurer> makeControlMeasurer();

} // namespace ngn::gtk
