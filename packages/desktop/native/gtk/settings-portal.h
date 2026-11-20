// The desktop's settings portal (org.freedesktop.portal.Settings) for keys of its
// org.freedesktop.appearance namespace: each is read once the portal answers, with ReadOne where
// the portal has it (version 2) and Read on an older one, and followed through SettingChanged. A
// session with no portal says nothing. A portal that restarts is read again as its new owner appears,
// and its keys are let go of (heard with a null value) as its owner goes. A reply asked of an earlier
// owner is dropped. On the GTK thread; replies after it goes find nothing to call.
#pragma once

#include <gio/gio.h>

#include <functional>
#include <string>
#include <vector>

namespace ngn::gtk {

class SettingsPortal {
 public:
  // `changed` hears a key and its value (as ReadOne gives it), at start and on each change, and a
  // null value when the portal's owner goes. The portal is on the session bus, or on `connection`
  // where a test gives one.
  SettingsPortal(
      std::vector<std::string> keys, std::function<void(const std::string &key, GVariant *value)> changed,
      GDBusConnection *connection = nullptr);
  ~SettingsPortal();
  SettingsPortal(const SettingsPortal &) = delete;
  SettingsPortal &operator=(const SettingsPortal &) = delete;

 private:
  // Asks for one key: with ReadOne, or with the older Read when `legacy`.
  void read(const std::string &key, bool legacy);
  void readAll();
  // The portal's owner appeared, changed or went.
  void ownerChanged();

  std::vector<std::string> keys_;
  std::function<void(const std::string &, GVariant *)> changed_;
  GCancellable *cancellable_{nullptr};
  GDBusProxy *proxy_{nullptr};
  // Counts the owners the portal has had: a reply asked of an earlier one is dropped.
  unsigned generation_{0};
};

// A portal value without the extra variant the older Read wraps it in: a new reference.
GVariant *portalValue(GVariant *value);

} // namespace ngn::gtk
