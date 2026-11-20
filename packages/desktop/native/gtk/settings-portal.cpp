#include "settings-portal.h"

#include <algorithm>
#include <cstring>
#include <memory>

namespace ngn::gtk {

GVariant *portalValue(GVariant *value) {
  GVariant *inner = value ? g_variant_ref(value) : nullptr;
  while (inner && g_variant_is_of_type(inner, G_VARIANT_TYPE_VARIANT)) {
    GVariant *next = g_variant_get_variant(inner);
    g_variant_unref(inner);
    inner = next;
  }
  return inner;
}

SettingsPortal::SettingsPortal(
    std::vector<std::string> keys, std::function<void(const std::string &, GVariant *)> changed, GDBusConnection *connection)
    : keys_(std::move(keys)), changed_(std::move(changed)), cancellable_(g_cancellable_new()) {
  auto ready = +[](GObject *, GAsyncResult *result, gpointer data) {
      GDBusProxy *proxy = g_dbus_proxy_new_finish(result, nullptr);
      if (!proxy) {
        return;
      }
      auto *self = static_cast<SettingsPortal *>(data);
      self->proxy_ = proxy;
      // A portal that restarts need not say its values again: read them as a new owner appears, and
      // let go of the old one's as it goes.
      g_signal_connect_swapped(proxy, "notify::g-name-owner", G_CALLBACK(+[](SettingsPortal *self) { self->ownerChanged(); }), self);
      auto signal = +[](SettingsPortal *self, const char *, const char *name, GVariant *params) {
        const char *ns = nullptr;
        const char *key = nullptr;
        GVariant *value = nullptr;
        if (std::strcmp(name, "SettingChanged") == 0 && g_variant_is_of_type(params, G_VARIANT_TYPE("(ssv)"))) {
          g_variant_get(params, "(&s&sv)", &ns, &key, &value);
          if (std::strcmp(ns, "org.freedesktop.appearance") == 0 &&
              std::find(self->keys_.begin(), self->keys_.end(), key) != self->keys_.end()) {
            self->changed_(key, value);
          }
          g_variant_unref(value);
        }
      };
      g_signal_connect_swapped(proxy, "g-signal", G_CALLBACK(signal), self);
      self->readAll();
  };
  const char *name = "org.freedesktop.portal.Desktop";
  const char *path = "/org/freedesktop/portal/desktop";
  const char *interface = "org.freedesktop.portal.Settings";
  if (connection) {
    g_dbus_proxy_new(connection, G_DBUS_PROXY_FLAGS_DO_NOT_LOAD_PROPERTIES, nullptr, name, path, interface, cancellable_, ready, this);
  } else {
    g_dbus_proxy_new_for_bus(
        G_BUS_TYPE_SESSION, G_DBUS_PROXY_FLAGS_DO_NOT_LOAD_PROPERTIES, nullptr, name, path, interface, cancellable_, ready, this);
  }
}

SettingsPortal::~SettingsPortal() {
  g_cancellable_cancel(cancellable_);
  g_clear_object(&cancellable_);
  if (proxy_) {
    g_signal_handlers_disconnect_by_data(proxy_, this);
    g_clear_object(&proxy_);
  }
}

void SettingsPortal::readAll() {
  for (const auto &key : keys_) {
    read(key, false);
  }
}

void SettingsPortal::ownerChanged() {
  // Replies asked of the last owner are no longer this one's to give.
  generation_++;
  char *owner = g_dbus_proxy_get_name_owner(proxy_);
  if (owner) {
    g_free(owner);
    readAll();
    return;
  }
  for (const auto &key : keys_) {
    changed_(key, nullptr);
  }
}

namespace {

// A read of one key, for the owner it was asked of.
struct PortalRead {
  SettingsPortal *self;
  std::string key;
  unsigned generation;
  bool legacy;
};

} // namespace

void SettingsPortal::read(const std::string &key, bool legacy) {
  g_dbus_proxy_call(
      proxy_, legacy ? "Read" : "ReadOne", g_variant_new("(ss)", "org.freedesktop.appearance", key.c_str()), G_DBUS_CALL_FLAGS_NONE, -1,
      cancellable_,
      +[](GObject *proxy, GAsyncResult *result, gpointer data) {
        std::unique_ptr<PortalRead> call(static_cast<PortalRead *>(data));
        GError *error = nullptr;
        GVariant *reply = g_dbus_proxy_call_finish(G_DBUS_PROXY(proxy), result, &error);
        if (!reply) {
          bool cancelled = g_error_matches(error, G_IO_ERROR, G_IO_ERROR_CANCELLED);
          bool unknown = g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_METHOD);
          g_error_free(error);
          // Only ReadOne's missing method asks the older Read: if that fails too, the portal has no
          // such setting, and nothing is heard.
          if (!cancelled && unknown && !call->legacy && call->generation == call->self->generation_) {
            call->self->read(call->key, true);
          }
          return;
        }
        if (call->generation == call->self->generation_) {
          GVariant *value = g_variant_get_child_value(reply, 0);
          call->self->changed_(call->key, value);
          g_variant_unref(value);
        }
        g_variant_unref(reply);
      },
      new PortalRead{this, key, generation_, legacy});
}

} // namespace ngn::gtk
