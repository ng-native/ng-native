// D-Bus objects of our own for the GTK tests, standing in for the system services a module reads
// through its properties (UPower, NetworkManager, power-profiles-daemon, the PowerProfileMonitor
// portal), over a peer-to-peer connection: each property's value is set by the test, and a change
// is announced with PropertiesChanged, as the service does.
#pragma once

#include "stand-in-portal.h"

#include <doctest/doctest.h>
#include <gio/gio.h>

#include <map>
#include <string>
#include <utility>
#include <vector>

namespace ngn::testing {

struct StandInServices {
  GDBusConnection *server{nullptr};
  GDBusConnection *client{nullptr};
  // Each object's introspection and values, by path.
  struct Object {
    std::string interface;
    GDBusNodeInfo *node{nullptr};
    std::map<std::string, GVariant *> values;
    guint registration{0};
  };
  std::map<std::string, Object> objects;

  StandInServices() {
    std::tie(server, client) = peerToPeer();
  }

  ~StandInServices() {
    for (auto &[path, object] : objects) {
      g_dbus_connection_unregister_object(server, object.registration);
      g_dbus_node_info_unref(object.node);
      for (auto &[name, value] : object.values) {
        g_variant_unref(value);
      }
    }
    g_dbus_connection_close_sync(client, nullptr, nullptr);
    g_object_unref(client);
    g_object_unref(server);
  }

  // An object at `path` with `interface`'s properties, typed by `types` ({"Percentage", "d"}), each
  // starting at its value in `values` (floating references, consumed).
  void add(const std::string &path, const std::string &interface, const std::vector<std::pair<std::string, std::string>> &types,
           const std::map<std::string, GVariant *> &values) {
    std::string xml = "<node><interface name=\"" + interface + "\">";
    for (const auto &[name, type] : types) {
      xml += "<property name=\"" + name + "\" type=\"" + type + "\" access=\"read\"/>";
    }
    xml += "</interface></node>";
    auto &object = objects[path];
    object.interface = interface;
    object.node = g_dbus_node_info_new_for_xml(xml.c_str(), nullptr);
    REQUIRE(object.node);
    for (const auto &[name, value] : values) {
      object.values[name] = g_variant_ref_sink(value);
    }
    static const GDBusInterfaceVTable vtable{
        nullptr,
        +[](GDBusConnection *, const gchar *, const gchar *path, const gchar *, const gchar *property, GError **error, gpointer data) -> GVariant * {
          auto &object = static_cast<StandInServices *>(data)->objects[path];
          auto it = object.values.find(property);
          if (it == object.values.end()) {
            g_set_error(error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS, "no %s", property);
            return nullptr;
          }
          return g_variant_ref(it->second);
        },
        nullptr};
    object.registration = g_dbus_connection_register_object(server, path.c_str(), object.node->interfaces[0], &vtable, this, nullptr, nullptr);
    REQUIRE(object.registration != 0);
  }

  // Sets a property and announces it.
  void set(const std::string &path, const std::string &property, GVariant *value) {
    auto &object = objects.at(path);
    if (auto it = object.values.find(property); it != object.values.end()) {
      g_variant_unref(it->second);
    }
    object.values[property] = g_variant_ref_sink(value);
    GVariantBuilder changed;
    g_variant_builder_init(&changed, G_VARIANT_TYPE_VARDICT);
    g_variant_builder_add(&changed, "{sv}", property.c_str(), object.values[property]);
    g_dbus_connection_emit_signal(server, nullptr, path.c_str(), "org.freedesktop.DBus.Properties", "PropertiesChanged",
                                  g_variant_new("(sa{sv}@as)", object.interface.c_str(), &changed, g_variant_new_strv(nullptr, 0)), nullptr);
  }
};

} // namespace ngn::testing
