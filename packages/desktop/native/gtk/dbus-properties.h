// A D-Bus service's object read through its properties, for the modules whose source is a system
// service with no portal (UPower, NetworkManager, power-profiles-daemon) or a portal with no
// Request (PowerProfileMonitor): a GDBusProxy made on the main context, without blocking, whose
// cached properties any thread reads. A service that is not running, or a bus that is not there,
// leaves every property null, which the caller reads as "not known".
#pragma once

#include <gio/gio.h>

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>

namespace ngn::gtk {

class DBusProperties {
 public:
  // The object at `path` on the service `name`, on `connection` when given (a peer-to-peer one in
  // the tests, where the name is not used), else on the `bus`.
  DBusProperties(GBusType bus, GDBusConnection *connection, std::string name, std::string path, std::string interface);
  ~DBusProperties();
  DBusProperties(const DBusProperties &) = delete;
  DBusProperties &operator=(const DBusProperties &) = delete;

  // The property's value now, or null. The caller owns the reference.
  GVariant *get(const char *property) const;

  // Calls `changed` on the main context once the object has been read and each time a property
  // changes, until the answer is called.
  std::function<void()> watch(std::function<void()> changed);

  // Whether the object has been read (or found missing): until then every property is null.
  bool ready() const;

 private:
  static void connected(GObject *, GAsyncResult *result, gpointer data);
  static void made(GObject *, GAsyncResult *result, gpointer data);
  void start(GDBusConnection *connection);
  void notify();

  std::string name_, path_, interface_;
  GCancellable *cancellable_;
  mutable std::mutex mutex_;
  GDBusProxy *proxy_{nullptr};
  bool ready_{false};
  int next_{0};

  // One watch. `calling` is held for the length of each call, so a stop waits for the call in
  // flight (or, from inside it, is the same thread and goes on); `active` is read under it, so
  // once a stop has returned the callback never starts again.
  struct Listener {
    std::function<void()> changed;
    std::recursive_mutex calling;
    bool active{true};
  };
  std::map<int, std::shared_ptr<Listener>> listeners_;
};

} // namespace ngn::gtk
