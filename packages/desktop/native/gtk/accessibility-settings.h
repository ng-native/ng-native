// The desktop's accessibility settings on GTK, as AccessibilityInfo reads them (host-state.h's
// linuxAccessibility): reduce motion from the settings portal's reduced-motion, GTK 4.22's
// gtk-interface-reduced-motion and gtk-enable-animations; increase contrast from the portal's
// contrast, libadwaita's high-contrast and GTK 4.20's gtk-interface-contrast; a screen reader from
// AT-SPI's org.a11y.Status. Each is read at start and followed as it changes; a source that is not
// there (an older GTK, no portal, no AT-SPI bus) counts as off.
#pragma once

#include "ngn/host-state.h"

#include <gio/gio.h>

#include <functional>
#include <memory>
#include <optional>

namespace ngn::gtk {

class SettingsPortal;

class AccessibilitySettingsWatcher {
 public:
  // `changed` hears the settings at start and on each change, on the GTK thread.
  explicit AccessibilitySettingsWatcher(std::function<void(const AccessibilitySettings &)> changed);
  ~AccessibilitySettingsWatcher();
  AccessibilitySettingsWatcher(const AccessibilitySettingsWatcher &) = delete;
  AccessibilitySettingsWatcher &operator=(const AccessibilitySettingsWatcher &) = delete;

  const LinuxAccessibilitySources &sources() const {
    return sources_;
  }

 private:
  void readGtk();
  void readPortal(const std::string &key, GVariant *value);
  void readStatus();
  void report();

  std::function<void(const AccessibilitySettings &)> changed_;
  LinuxAccessibilitySources sources_;
  std::optional<AccessibilitySettings> reported_;
  GCancellable *cancellable_{nullptr};
  std::unique_ptr<SettingsPortal> portal_;
  GDBusProxy *status_{nullptr};
};

} // namespace ngn::gtk
