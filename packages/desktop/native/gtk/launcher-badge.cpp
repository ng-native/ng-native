#include "launcher-badge.h"

#include <gio/gio.h>

#include <atomic>

namespace ngn::gtk {

namespace {

class LauncherBadgeCenter final : public NotificationCenter {
 public:
  explicit LauncherBadgeCenter(const std::string &appId) : uri_(launcherEntryUri(appId)) {}

  bool canPost() override {
    return false;
  }
  void authorization(std::function<void(NotificationAuthorization)> done) override {
    done(NotificationAuthorization::Denied);
  }
  void requestAuthorization(std::function<void(NotificationAuthorization)> done) override {
    done(NotificationAuthorization::Denied);
  }
  void add(const NotificationRequest &, std::function<void(std::optional<std::string>)> done) override {
    done(std::string("Notifications cannot be posted on Linux yet"));
  }
  void pending(std::function<void(std::vector<NotificationRequest>)> done) override {
    done({});
  }
  void delivered(std::function<void(std::vector<std::pair<double, NotificationRequest>>)> done) override {
    done({});
  }
  void removePending(const std::vector<std::string> &) override {}
  void removeAllPending() override {}
  void removeDelivered(const std::vector<std::string> &) override {}
  void removeAllDelivered() override {}
  std::optional<double> nextDate(const NotificationTrigger &) override {
    return std::nullopt;
  }

  int badge() override {
    return count_;
  }

  // Sent each time, so a dock that starts later hears the next one: no dock asks for it.
  void setBadge(int count) override {
    count_ = count;
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
        g_variant_new("(sa{sv})", uri_.c_str(), &props), nullptr);
    g_dbus_connection_flush_sync(bus, nullptr, nullptr);
    g_object_unref(bus);
  }

 private:
  std::string uri_;
  std::atomic<int> count_{0};
};

} // namespace

std::string launcherEntryUri(const std::string &appId) {
  return "application://" + appId + ".desktop";
}

std::shared_ptr<NotificationCenter> makeLauncherBadgeNotifications(const std::string &appId) {
  return std::make_shared<LauncherBadgeCenter>(appId);
}

} // namespace ngn::gtk
