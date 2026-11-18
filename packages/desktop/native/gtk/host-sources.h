// What the GTK host passes the core for the OS, as far as this backend reaches it yet: the System
// over GLib and libadwaita, and stand-ins for what later steps add (menus, the tray and native
// controls), each of which refuses or does nothing rather than pretend. Networking is the core's
// libcurl client (curl-network.h).
#pragma once

#include "ngn/app-menus.h"
#include "ngn/app-windows.h"
#include "ngn/native-controls.h"
#include "ngn/network-state.h"
#include "ngn/system.h"
#include "ngn/tray-and-dock.h"

#include <functional>
#include <memory>
#include <string>

namespace ngn::gtk {

// Preferences in `<appData>/preferences.ini`, the colour scheme from libadwaita's style manager,
// the clipboard in memory (GDK's is asynchronous, which System's is not), alerts logged and
// cancelled until the dialogs come.
std::shared_ptr<System> makeSystem(const std::string &appId, const std::string &appDataDirectory);

// Whether Linking can open `uri`: one with a scheme the desktop has an app for. Inside a sandbox the
// desktop portal decides as it opens it, so any scheme can be tried there.
bool canOpenUri(const std::string &uri, bool sandboxed, const std::function<bool(const std::string &scheme)> &hasHandler);

// Strings in a key file at `path`, written on each change.
std::shared_ptr<StringStore> makeKeyFileStore(const std::string &path);

std::shared_ptr<MenuBackend> makeNoMenus();
std::shared_ptr<TrayBackend> makeNoTray();
std::shared_ptr<DockBackend> makeNoDock();

// Whether the network is reachable, from GLib's GNetworkMonitor.
std::shared_ptr<PathMonitor> makePathMonitor();

// A native control's size before the GTK controls come: one fixed size for every control.
std::shared_ptr<ControlMeasurer> makeControlMeasurer();

} // namespace ngn::gtk
