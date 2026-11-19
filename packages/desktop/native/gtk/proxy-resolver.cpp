#include "proxy-resolver.h"

#include <atomic>

namespace ngn::gtk {

namespace {

// How long a lookup waits for the portal, which may itself evaluate a PAC script.
constexpr int kPortalTimeoutMs = 5000;

// Set once the session has shown it has no proxy portal: not asked again.
std::atomic<bool> gNoPortal{false};

std::vector<std::string> strings(const gchar *const *list) {
  std::vector<std::string> out;
  for (auto *item = list; item && *item; ++item) {
    out.emplace_back(*item);
  }
  return out;
}

// No portal on the bus, or none with this interface: not a failure of this one lookup.
bool portalMissing(const GError *error) {
  return g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_SERVICE_UNKNOWN) ||
      g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_NAME_HAS_NO_OWNER) ||
      g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_METHOD) ||
      g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_INTERFACE) ||
      g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_OBJECT);
}

} // namespace

std::vector<std::string> desktopProxies(const std::string &url, GDBusConnection *bus, GProxyResolver *fallback) {
  if (bus) {
    GError *error = nullptr;
    // A message bus routes to the portal by name; a connection straight to one has no names.
    const char *name = g_dbus_connection_get_unique_name(bus) ? "org.freedesktop.portal.Desktop" : nullptr;
    GVariant *reply = g_dbus_connection_call_sync(
        bus, name, "/org/freedesktop/portal/desktop", "org.freedesktop.portal.ProxyResolver", "Lookup",
        g_variant_new("(s)", url.c_str()), G_VARIANT_TYPE("(as)"), G_DBUS_CALL_FLAGS_NONE, kPortalTimeoutMs, nullptr,
        &error);
    if (reply) {
      const gchar **list = nullptr;
      g_variant_get(reply, "(^a&s)", &list);
      auto out = strings(list);
      g_free(list);
      g_variant_unref(reply);
      return out;
    }
    if (portalMissing(error)) {
      gNoPortal = true;
    }
    g_error_free(error);
  }
  if (!fallback) {
    return {};
  }
  gchar **list = g_proxy_resolver_lookup(fallback, url.c_str(), nullptr, nullptr);
  auto out = strings(list);
  g_strfreev(list);
  return out;
}

std::vector<std::string> desktopProxies(const std::string &url) {
  GDBusConnection *bus = gNoPortal ? nullptr : g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
  auto out = desktopProxies(url, bus, g_proxy_resolver_get_default());
  if (bus) {
    g_object_unref(bus);
  }
  return out;
}

} // namespace ngn::gtk
