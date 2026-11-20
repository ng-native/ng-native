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

// Whether a gtk-interface-contrast value asks for more contrast. GtkInterfaceContrast is 0
// unsupported, 1 no preference, 2 more, 3 less: only 2 does.
bool gtkWantsMoreContrast(int interfaceContrast);

class AccessibilitySettingsWatcher {
 public:
  // `changed` hears the settings at start and on each change, on the GTK thread. The portal and
  // AT-SPI are reached through the session bus, or through `connection` where a test gives one.
  explicit AccessibilitySettingsWatcher(std::function<void(const AccessibilitySettings &)> changed, GDBusConnection *connection = nullptr);
  ~AccessibilitySettingsWatcher();
  AccessibilitySettingsWatcher(const AccessibilitySettingsWatcher &) = delete;
  AccessibilitySettingsWatcher &operator=(const AccessibilitySettingsWatcher &) = delete;

  const LinuxAccessibilitySources &sources() const {
    return sources_;
  }

 private:
  void readGtk();
<<<<<<< HEAD
  void readPortalSetting(const char *key, const char *method);
  void readPortal(const char *key, GVariant *value);
=======
  // Asks the portal for reduced-motion: with ReadOne, or with the older Read when `legacy`.
  void readPortalSetting(bool legacy);
  // The portal's owner appeared, changed or went.
  void portalOwnerChanged();
  void readPortal(GVariant *value);
>>>>>>> 98e94296e
  void readStatus();
  void report();

  std::function<void(const AccessibilitySettings &)> changed_;
  LinuxAccessibilitySources sources_;
  std::optional<AccessibilitySettings> reported_;
  GCancellable *cancellable_{nullptr};
  GDBusProxy *portal_{nullptr};
  // Counts the owners the portal has had: a reply for an earlier one is dropped.
  unsigned portalRead_{0};
  GDBusProxy *status_{nullptr};
};

// The host's state with its accessibility settings kept in step by a watcher: made together, so
// the state of a running app never lacks its feed. Only the instance that runs the app makes one;
// a second launch hands its links on and exits before it has any state to feed.
struct WatchedHostState {
  std::shared_ptr<HostState> state;
  std::unique_ptr<AccessibilitySettingsWatcher> accessibility;
};

WatchedHostState makeWatchedHostState();

} // namespace ngn::gtk
