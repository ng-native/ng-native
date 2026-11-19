// The OS half of NgNativeNetwork on Linux (the core's network-state.h): whether a route exists from
// GLib's GNetworkMonitor (the NetworkMonitor portal inside a sandbox), and its type from
// NetworkManager's primary connection. Without NetworkManager (a sandbox that may not reach it, or
// a system without it) a route's type is OTHER.
#pragma once

#include "ngn/network-state.h"

#include <gio/gio.h>

#include <memory>
#include <string>

namespace ngn::gtk {

// The path for a route that is there or not, of NetworkManager's connection type
// ("802-11-wireless", "802-3-ethernet", "gsm"), empty where it is not known.
NetworkPath networkPathOf(bool available, const std::string &connectionType);

// Made on the main context. `connection`, in the tests, is a peer-to-peer connection to a stand-in
// NetworkManager, in place of the system bus.
std::shared_ptr<PathMonitor> makePathMonitor(GDBusConnection *connection = nullptr);

} // namespace ngn::gtk
