// The app's status items in the menu bar (NSStatusItem) and its Dock icon's menu and bounce, as
// the core's TrayBackend and DockBackend (tray-and-dock.h).
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/tray-and-dock.h"

#include <functional>
#include <map>
#include <string>

namespace ngn::appkit {

class AppKitTray final : public TrayBackend {
 public:
  // What a click does: `pressed` for an icon with no menu, `chose` for an item of one's menu.
  AppKitTray(std::function<void(const std::string &icon)> pressed,
             std::function<void(const std::string &icon, const std::string &id)> chose);
  void setIcons(std::vector<TrayIcon> icons) override;

 private:
  std::function<void(const std::string &)> pressed_;
  std::function<void(const std::string &, const std::string &)> chose_;
  NSMutableDictionary<NSString *, NSStatusItem *> *items_;
};

class AppKitDock final : public DockBackend {
 public:
  explicit AppKitDock(std::function<void(const std::string &id)> chose);
  void setMenu(std::optional<std::vector<MenuItem>> menu) override;
  void bounce(int id, bool critical) override;
  void cancelBounce(int id) override;
  // What the app delegate's applicationDockMenu: answers. Main thread.
  NSMenu *menu() const {
    return menu_;
  }

 private:
  std::function<void(const std::string &)> chose_;
  NSMenu *menu_;
  std::map<int, NSInteger> requests_;
};

} // namespace ngn::appkit
