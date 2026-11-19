// The desktop's settings portal (org.freedesktop.portal.Settings) for keys of its
// org.freedesktop.appearance namespace: each is read once the portal answers, with ReadOne where
// the portal has it (version 2) and Read on an older one, and followed through SettingChanged. A
// session with no portal says nothing. On the GTK thread; replies after it goes find nothing to call.
#pragma once

#include <gio/gio.h>

#include <functional>
#include <string>
#include <vector>

namespace ngn::gtk {

class SettingsPortal {
 public:
  // `changed` hears a key and its value (as ReadOne gives it), at start and on each change.
  SettingsPortal(std::vector<std::string> keys, std::function<void(const std::string &key, GVariant *value)> changed);
  ~SettingsPortal();
  SettingsPortal(const SettingsPortal &) = delete;
  SettingsPortal &operator=(const SettingsPortal &) = delete;

 private:
  void read(const std::string &key, const char *method);

  std::vector<std::string> keys_;
  std::function<void(const std::string &, GVariant *)> changed_;
  GCancellable *cancellable_{nullptr};
  GDBusProxy *proxy_{nullptr};
};

// A portal value without the extra variant the older Read wraps it in: a new reference.
GVariant *portalValue(GVariant *value);

} // namespace ngn::gtk
