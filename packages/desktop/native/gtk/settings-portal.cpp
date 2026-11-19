#include "settings-portal.h"

#include <algorithm>
#include <cstring>

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

SettingsPortal::SettingsPortal(std::vector<std::string> keys, std::function<void(const std::string &, GVariant *)> changed)
    : keys_(std::move(keys)), changed_(std::move(changed)), cancellable_(g_cancellable_new()) {
  g_dbus_proxy_new_for_bus(
      G_BUS_TYPE_SESSION, G_DBUS_PROXY_FLAGS_DO_NOT_LOAD_PROPERTIES, nullptr, "org.freedesktop.portal.Desktop",
      "/org/freedesktop/portal/desktop", "org.freedesktop.portal.Settings", cancellable_,
      +[](GObject *, GAsyncResult *result, gpointer data) {
        GDBusProxy *proxy = g_dbus_proxy_new_for_bus_finish(result, nullptr);
        if (!proxy) {
          return;
        }
        auto *self = static_cast<SettingsPortal *>(data);
        self->proxy_ = proxy;
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
        for (const auto &key : self->keys_) {
          self->read(key, "ReadOne");
        }
      },
      this);
}

SettingsPortal::~SettingsPortal() {
  g_cancellable_cancel(cancellable_);
  g_clear_object(&cancellable_);
  if (proxy_) {
    g_signal_handlers_disconnect_by_data(proxy_, this);
    g_clear_object(&proxy_);
  }
}

void SettingsPortal::read(const std::string &key, const char *method) {
  struct Call {
    SettingsPortal *self;
    std::string key;
  };
  g_dbus_proxy_call(
      proxy_, method, g_variant_new("(ss)", "org.freedesktop.appearance", key.c_str()), G_DBUS_CALL_FLAGS_NONE, -1,
      cancellable_,
      +[](GObject *proxy, GAsyncResult *result, gpointer data) {
        auto *call = static_cast<Call *>(data);
        GError *error = nullptr;
        GVariant *reply = g_dbus_proxy_call_finish(G_DBUS_PROXY(proxy), result, &error);
        if (!reply) {
          bool cancelled = g_error_matches(error, G_IO_ERROR, G_IO_ERROR_CANCELLED);
          bool unknown = g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_METHOD);
          g_error_free(error);
          if (!cancelled && unknown) {
            call->self->read(call->key, "Read");
          }
          delete call;
          return;
        }
        GVariant *value = g_variant_get_child_value(reply, 0);
        call->self->changed_(call->key, value);
        g_variant_unref(value);
        g_variant_unref(reply);
        delete call;
      },
      new Call{this, key});
}

} // namespace ngn::gtk
