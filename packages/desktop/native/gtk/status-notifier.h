// The tray on Linux (tray-and-dock.h's TrayBackend): each `<tray-icon>` a StatusNotifierItem with
// its menu as com.canonical.dbusmenu (dbus-menu.h), over GDBus, as KDE Plasma, the AppIndicator
// extension for GNOME and the other StatusNotifierWatcher hosts draw them. Each icon has a
// session-bus connection of its own, its item at /StatusNotifierItem and its menu at /MenuBar,
// registered with the watcher by that path, so closing the connection takes the icon away. An icon
// with a menu is ItemIsMenu, which a click opens; one without is pressed by Activate.
//
// The icon is `image` as an icon theme's name, else the app's own icon (its application id, as
// the package installs it); an SF Symbol has no Linux equivalent and is not drawn. The title is
// the item's Title, and the tooltip its ToolTip. A watcher that restarts (Plasma's shell, say) is
// given every icon again.
#pragma once

#include "ngn/tray-and-dock.h"

#include <gio/gio.h>

#include <functional>
#include <memory>
#include <string>

namespace ngn::gtk {

// The watcher's well-known name on the session bus.
inline constexpr const char *kStatusNotifierWatcher = "org.kde.StatusNotifierWatcher";

// Whether a StatusNotifierWatcher runs on the session bus: without one (stock GNOME, Fedora without
// the AppIndicator extension) the tray is absent.
bool statusNotifierWatcherRunning();

struct TrayEvents {
  // A click on an icon with no menu.
  std::function<void(const std::string &icon)> press;
  // An item of an icon's menu chosen, by the app's id for it.
  std::function<void(const std::string &icon, const std::string &id)> menuSelect;
  // An item with the OS's command chosen (a `menuRole` such as quit), which the host runs.
  std::function<void(MenuCommand command)> command;
};

// The icons, each `<appId>-<icon id>` to the watcher. Events come on the UI thread.
std::shared_ptr<TrayBackend> makeStatusNotifierTray(const std::string &appId, TrayEvents events);

} // namespace ngn::gtk
