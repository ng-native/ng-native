#include "launcher-badge.h"

#include <gio/gio.h>

namespace ngn::gtk {

std::string launcherEntryUri(const std::string &appId) {
  return "application://" + appId + ".desktop";
}

std::function<void(int)> makeLauncherBadge(const std::string &appId) {
  return [uri = launcherEntryUri(appId)](int count) {
    GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
    if (!bus) {
      return;
    }
    GVariantBuilder props;
    g_variant_builder_init(&props, G_VARIANT_TYPE("a{sv}"));
    g_variant_builder_add(&props, "{sv}", "count", g_variant_new_int64(count > 0 ? count : 0));
    g_variant_builder_add(&props, "{sv}", "count-visible", g_variant_new_boolean(count > 0));
    g_dbus_connection_emit_signal(
        bus, nullptr, "/com/canonical/unity/launcherentry", kLauncherEntryInterface, "Update",
        g_variant_new("(sa{sv})", uri.c_str(), &props), nullptr);
    g_dbus_connection_flush_sync(bus, nullptr, nullptr);
    g_object_unref(bus);
  };
}

} // namespace ngn::gtk
