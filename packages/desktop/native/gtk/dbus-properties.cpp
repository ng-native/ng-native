#include "dbus-properties.h"

#include <vector>

namespace ngn::gtk {

namespace {

bool cancelled(GError *error) {
  bool was = g_error_matches(error, G_IO_ERROR, G_IO_ERROR_CANCELLED);
  g_clear_error(&error);
  return was;
}

} // namespace

DBusProperties::DBusProperties(GBusType bus, GDBusConnection *connection, std::string name, std::string path, std::string interface)
    : name_(std::move(name)), path_(std::move(path)), interface_(std::move(interface)), cancellable_(g_cancellable_new()) {
  // Made on the main context, where the proxy's signals then arrive.
  if (connection) {
    start(connection);
  } else {
    g_bus_get(bus, cancellable_, connected, this);
  }
}

DBusProperties::~DBusProperties() {
  g_cancellable_cancel(cancellable_);
  g_object_unref(cancellable_);
  if (proxy_) {
    g_signal_handlers_disconnect_by_data(proxy_, this);
    g_object_unref(proxy_);
  }
}

void DBusProperties::connected(GObject *, GAsyncResult *result, gpointer data) {
  GError *error = nullptr;
  GDBusConnection *connection = g_bus_get_finish(result, &error);
  if (!connection) {
    if (cancelled(error)) {
      return;
    }
    // No such bus: nothing is known, and that is final.
    auto *self = static_cast<DBusProperties *>(data);
    {
      std::lock_guard lock(self->mutex_);
      self->ready_ = true;
    }
    self->notify();
    return;
  }
  static_cast<DBusProperties *>(data)->start(connection);
  g_object_unref(connection);
}

void DBusProperties::start(GDBusConnection *connection) {
  // A peer-to-peer connection has no bus, and so no names.
  const char *name = g_dbus_connection_get_unique_name(connection) ? name_.c_str() : nullptr;
  g_dbus_proxy_new(connection, G_DBUS_PROXY_FLAGS_GET_INVALIDATED_PROPERTIES, nullptr, name, path_.c_str(), interface_.c_str(),
                   cancellable_, made, this);
}

void DBusProperties::made(GObject *, GAsyncResult *result, gpointer data) {
  GError *error = nullptr;
  GDBusProxy *proxy = g_dbus_proxy_new_finish(result, &error);
  if (!proxy && cancelled(error)) {
    return;
  }
  auto *self = static_cast<DBusProperties *>(data);
  if (proxy) {
    g_signal_connect(proxy, "g-properties-changed", G_CALLBACK(+[](GDBusProxy *, GVariant *, GStrv, gpointer self) {
      static_cast<DBusProperties *>(self)->notify();
    }), self);
    // The service started, or went: its properties come, or go, all at once.
    g_signal_connect(proxy, "notify::g-name-owner", G_CALLBACK(+[](GObject *, GParamSpec *, gpointer self) {
      static_cast<DBusProperties *>(self)->notify();
    }), self);
  }
  {
    std::lock_guard lock(self->mutex_);
    self->proxy_ = proxy;
    self->ready_ = true;
  }
  self->notify();
}

void DBusProperties::notify() {
  std::vector<std::shared_ptr<Listener>> listeners;
  {
    std::lock_guard lock(mutex_);
    for (const auto &[id, listener] : listeners_) {
      listeners.push_back(listener);
    }
  }
  for (const auto &listener : listeners) {
    // A listener stopped by an earlier one in this round, or from another thread, is not called.
    std::lock_guard calling(listener->calling);
    if (listener->active) {
      listener->changed();
    }
  }
}

GVariant *DBusProperties::get(const char *property) const {
  std::lock_guard lock(mutex_);
  return proxy_ ? g_dbus_proxy_get_cached_property(proxy_, property) : nullptr;
}

bool DBusProperties::ready() const {
  std::lock_guard lock(mutex_);
  return ready_;
}

std::function<void()> DBusProperties::watch(std::function<void()> changed) {
  std::lock_guard lock(mutex_);
  int id = ++next_;
  auto listener = std::make_shared<Listener>();
  listener->changed = std::move(changed);
  listeners_[id] = listener;
  return [this, id, listener] {
    {
      std::lock_guard lock(mutex_);
      listeners_.erase(id);
    }
    // Waits for a call in flight on another thread; the listener stopping itself is that call.
    std::lock_guard calling(listener->calling);
    listener->active = false;
  };
}

} // namespace ngn::gtk
