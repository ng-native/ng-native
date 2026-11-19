// A stand-in for the desktop's settings portal (org.freedesktop.portal.Settings) on the session
// bus, for tests of what the GTK host reads from it: it owns the portal's name while it lives,
// answers ReadOne and Read from the values it holds, and sends SettingChanged when one is set.
//
// It answers from a thread of its own, on a connection of its own: GTK and libadwaita call the
// portal synchronously from the main thread, which would wait forever on an answer the main thread
// itself had to give. Needs a session bus (dbus-run-session); `owned()` is false without one.
#pragma once

#include <gio/gio.h>

#include <atomic>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <utility>

namespace ngn::testing {

class FakeSettingsPortal {
 public:
  // Values by namespace and key, as the portal holds them.
  using Key = std::pair<std::string, std::string>;

  // `startDelayMs` holds the worker back before its loop, and `waitMs` is how long the constructor
  // waits for the name, both for testing a slow start.
  explicit FakeSettingsPortal(std::map<Key, GVariant *> values = {}, int startDelayMs = 0, int waitMs = 2000)
      : values_(std::move(values)), startDelayMs_(startDelayMs), waitMs_(waitMs) {
    for (auto &[key, value] : values_) {
      g_variant_ref_sink(value);
    }
    const char *address = g_getenv("DBUS_SESSION_BUS_ADDRESS");
    if (!address) {
      return;
    }
    context_ = g_main_context_new();
    loop_ = g_main_loop_new(context_, FALSE);
    thread_ = std::thread([this, address = std::string(address)] { run(address); });
    // Until the name is the fake's, or the thread gave up.
    for (int i = 0; i < waitMs_ / 5 && !owned_ && !failed_; ++i) {
      g_usleep(5000);
    }
  }

  ~FakeSettingsPortal() {
    if (thread_.joinable()) {
      // From a source on the worker's context, so a quit asked before the worker reaches its loop
      // lands once the loop runs. g_main_context_invoke would run it here, on a free context.
      GSource *quit = g_idle_source_new();
      g_source_set_callback(
          quit, [](gpointer loop) { g_main_loop_quit(static_cast<GMainLoop *>(loop)); return G_SOURCE_REMOVE; }, loop_, nullptr);
      g_source_attach(quit, context_);
      g_source_unref(quit);
      thread_.join();
    }
    if (loop_) {
      g_main_loop_unref(loop_);
      g_main_context_unref(context_);
    }
    for (auto &[key, value] : values_) {
      g_variant_unref(value);
    }
  }
  FakeSettingsPortal(const FakeSettingsPortal &) = delete;
  FakeSettingsPortal &operator=(const FakeSettingsPortal &) = delete;

  bool owned() const {
    return owned_;
  }

  // Sets a value and tells the bus, as the portal does when the user changes it.
  void set(const std::string &ns, const std::string &key, GVariant *value) {
    g_variant_ref_sink(value);
    {
      std::lock_guard lock(mutex_);
      auto [it, added] = values_.try_emplace({ns, key}, value);
      if (!added) {
        g_variant_unref(it->second);
        it->second = value;
      }
    }
    g_dbus_connection_emit_signal(
        bus_, nullptr, kPath, kInterface, "SettingChanged", g_variant_new("(ssv)", ns.c_str(), key.c_str(), value), nullptr);
    g_dbus_connection_flush_sync(bus_, nullptr, nullptr);
  }

  // Turns the main loop until `done`, for at most two seconds.
  template <typename Done>
  static bool spinUntil(Done done) {
    for (int i = 0; i < 400 && !done(); ++i) {
      g_main_context_iteration(nullptr, FALSE);
      g_usleep(5000);
    }
    return done();
  }

 private:
  static constexpr const char *kPath = "/org/freedesktop/portal/desktop";
  static constexpr const char *kInterface = "org.freedesktop.portal.Settings";
  static constexpr const char *kXml = R"(<node>
  <interface name="org.freedesktop.portal.Settings">
    <method name="ReadOne"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
    <method name="Read"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
    <signal name="SettingChanged"><arg type="s"/><arg type="s"/><arg type="v"/></signal>
  </interface>
</node>)";

  void run(const std::string &address) {
    g_main_context_push_thread_default(context_);
    bus_ = g_dbus_connection_new_for_address_sync(
        address.c_str(), GDBusConnectionFlags(G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT | G_DBUS_CONNECTION_FLAGS_MESSAGE_BUS_CONNECTION),
        nullptr, nullptr, nullptr);
    if (!bus_) {
      failed_ = true;
      g_main_context_pop_thread_default(context_);
      return;
    }
    GDBusNodeInfo *info = g_dbus_node_info_new_for_xml(kXml, nullptr);
    static const GDBusInterfaceVTable vtable{
        .method_call = [](GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *method, GVariant *args,
                          GDBusMethodInvocation *invocation, gpointer data) {
          auto *self = static_cast<FakeSettingsPortal *>(data);
          const gchar *ns = nullptr;
          const gchar *key = nullptr;
          g_variant_get(args, "(&s&s)", &ns, &key);
          std::lock_guard lock(self->mutex_);
          auto it = self->values_.find({ns, key});
          if (it == self->values_.end()) {
            g_dbus_method_invocation_return_dbus_error(invocation, "org.freedesktop.portal.Error.NotFound", "no such setting");
            return;
          }
          // ReadOne gives the value; the older Read wraps it in a second variant.
          GVariant *value = g_strcmp0(method, "Read") == 0 ? g_variant_new_variant(it->second) : it->second;
          g_dbus_method_invocation_return_value(invocation, g_variant_new("(v)", value));
        },
    };
    guint object = g_dbus_connection_register_object(bus_, kPath, info->interfaces[0], &vtable, this, nullptr, nullptr);
    guint name = g_bus_own_name_on_connection(
        bus_, "org.freedesktop.portal.Desktop", G_BUS_NAME_OWNER_FLAGS_REPLACE,
        [](GDBusConnection *, const gchar *, gpointer data) { static_cast<FakeSettingsPortal *>(data)->owned_ = true; },
        [](GDBusConnection *, const gchar *, gpointer data) { static_cast<FakeSettingsPortal *>(data)->failed_ = true; }, this, nullptr);
    g_usleep(startDelayMs_ * 1000);
    g_main_loop_run(loop_);
    g_bus_unown_name(name);
    g_dbus_connection_unregister_object(bus_, object);
    g_dbus_node_info_unref(info);
    g_dbus_connection_close_sync(bus_, nullptr, nullptr);
    g_clear_object(&bus_);
    g_main_context_pop_thread_default(context_);
  }

  std::map<Key, GVariant *> values_;
  int startDelayMs_;
  int waitMs_;
  std::mutex mutex_;
  GMainContext *context_{nullptr};
  GMainLoop *loop_{nullptr};
  GDBusConnection *bus_{nullptr};
  std::thread thread_;
  std::atomic<bool> owned_{false};
  std::atomic<bool> failed_{false};
};

} // namespace ngn::testing
