#include "network-state.h"

#include "dbus-properties.h"

#include <set>

namespace ngn::gtk {

namespace {

// GLib's monitor for the route, NetworkManager's PrimaryConnectionType for its kind. Both report
// on the main context, so one change at a time reaches the watch, in order.
class NetworkManagerMonitor final : public PathMonitor {
 public:
  explicit NetworkManagerMonitor(GDBusConnection *connection)
      : manager_(G_BUS_TYPE_SYSTEM, connection, "org.freedesktop.NetworkManager", "/org/freedesktop/NetworkManager",
                 "org.freedesktop.NetworkManager") {}

  std::function<void()> watch(std::function<void(const NetworkPath &)> changed) override {
    auto heap = std::make_shared<std::function<void(const NetworkPath &)>>(std::move(changed));
    GNetworkMonitor *monitor = g_network_monitor_get_default();
    auto report = [this, heap, monitor] { (*heap)(networkPathOf(g_network_monitor_get_network_available(monitor), connectionType())); };
    report();
    auto *listener = new std::function<void()>(report);
    gulong handler = g_signal_connect_data(
        monitor, "network-changed", G_CALLBACK(+[](GNetworkMonitor *, gboolean, gpointer data) { (*static_cast<std::function<void()> *>(data))(); }),
        listener, [](gpointer data, GClosure *) { delete static_cast<std::function<void()> *>(data); }, GConnectFlags(0));
    auto stop = manager_.watch(report);
    return [monitor, handler, stop] {
      stop();
      g_signal_handler_disconnect(monitor, handler);
    };
  }

 private:
  std::string connectionType() {
    GVariant *type = manager_.get("PrimaryConnectionType");
    std::string out = type && g_variant_is_of_type(type, G_VARIANT_TYPE_STRING) ? g_variant_get_string(type, nullptr) : "";
    if (type) {
      g_variant_unref(type);
    }
    return out;
  }

  DBusProperties manager_;
};

} // namespace

NetworkPath networkPathOf(bool available, const std::string &connectionType) {
  NetworkPath path{.satisfied = available};
  if (!available) {
    return path;
  }
  static const std::set<std::string> cellular{"gsm", "cdma"};
  if (connectionType == "802-11-wireless") {
    path.wifi = true;
  } else if (connectionType == "802-3-ethernet") {
    path.ethernet = true;
  } else if (cellular.count(connectionType)) {
    path.cellular = true;
  } else {
    path.other = true;
  }
  return path;
}

std::shared_ptr<PathMonitor> makePathMonitor(GDBusConnection *connection) {
  return std::make_shared<NetworkManagerMonitor>(connection);
}

} // namespace ngn::gtk
