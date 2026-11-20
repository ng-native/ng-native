// The desktop's accent colour below libadwaita 1.6, which draws its own blue whatever the desktop
// says: the settings portal's org.freedesktop.appearance accent-color, worked out as libadwaita 1.6
// does (the core's accent-colors.h) and applied over libadwaita's stylesheet as its accent_bg_color,
// accent_fg_color and accent_color, again as the style turns dark or light and as the desktop's
// accent changes. From 1.6 libadwaita follows the portal itself and this does nothing.
#pragma once

#include "ngn/accent-colors.h"

#include <gtk/gtk.h>

#include <memory>
#include <optional>
#include <string>

namespace ngn::gtk {

class SettingsPortal;

class AccentFollower {
 public:
  AccentFollower();
  ~AccentFollower();
  AccentFollower(const AccentFollower &) = delete;
  AccentFollower &operator=(const AccentFollower &) = delete;

  // The CSS applied now: empty when the desktop sets no accent, or libadwaita follows it itself.
  const std::string &css() const {
    return css_;
  }

 private:
  void apply();

  std::unique_ptr<SettingsPortal> portal_;
  std::optional<Rgb> accent_;
  GtkCssProvider *provider_{nullptr};
  std::string css_;
};

} // namespace ngn::gtk
