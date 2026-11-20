// The desktop's proxy settings for the libcurl client (curl-network.h's desktopProxies): the proxy
// portal's answer (org.freedesktop.portal.ProxyResolver, which a Flatpak app must use) when a portal
// answers, else GLib's own GProxyResolver's, which reads GNOME's or KDE's settings through
// glib-networking and answers `direct://` without it. Portal first, as for every portal. Blocking:
// for the network thread, any thread.
#pragma once

#include <gio/gio.h>

#include <string>
#include <vector>

namespace ngn::gtk {

std::vector<std::string> desktopProxies(const std::string &url);

// The same over `bus` (null: no portal to ask) and `fallback`.
std::vector<std::string> desktopProxies(const std::string &url, GDBusConnection *bus, GProxyResolver *fallback);

} // namespace ngn::gtk
