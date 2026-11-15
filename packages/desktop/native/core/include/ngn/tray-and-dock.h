// The app's icons in the menu bar's status area (`NgNativeTray`) and its Dock icon's menu and
// bounce (`NgNativeDock`). Menus come in the form the menu bar's take (app-menus.h).
//
// A reloaded app starts with no tray icons and no Dock menu: what the old one set goes as the new
// one's module starts, and the new app sets its own.
#pragma once

#include "ngn/app-menus.h"
#include "ngn/native-module.h"

#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace ngn {

struct TrayIcon {
  std::string id;
  std::string title;
  std::string sfSymbol;
  // An image asset of the app's own, by name.
  std::string image;
  std::string tooltip;
  // The menu a click opens; with none, a click is a press.
  std::optional<std::vector<MenuItem>> menu;
  bool operator==(const TrayIcon &) const = default;
};

std::vector<TrayIcon> parseTrayIcons(const folly::dynamic &icons);

class TrayBackend {
 public:
  virtual ~TrayBackend() = default;
  // Every icon, in place of those before: an icon whose id was there before keeps its place.
  virtual void setIcons(std::vector<TrayIcon> icons) = 0;
};

// Listeners for the events a module sends, and whether a runtime's module came before.
class EventSource {
 public:
  using Listener = std::function<void(const folly::dynamic &event)>;
  // True from the second listener on: the app reloaded.
  std::shared_ptr<void> listen(Listener listener, bool &reloaded);
  void send(const folly::dynamic &event);

 private:
  std::mutex mutex_;
  std::map<int, Listener> listeners_;
  int next_{0};
};

class TrayHost {
 public:
  explicit TrayHost(std::shared_ptr<TrayBackend> backend);

  void setIcons(const folly::dynamic &icons);
  // A click on an icon with no menu, or the choice of an item in an icon's menu.
  void press(const std::string &icon);
  void menuSelect(const std::string &icon, const std::string &id);

  std::shared_ptr<void> attach(EventSource::Listener listener);

 private:
  std::shared_ptr<TrayBackend> backend_;
  EventSource events_;
};

class DockBackend {
 public:
  virtual ~DockBackend() = default;
  // The app's items above the Dock menu's own, or none.
  virtual void setMenu(std::optional<std::vector<MenuItem>> menu) = 0;
  // Ask for attention (`critical` bounces until the app is active) under the core's `id`.
  virtual void bounce(int id, bool critical) = 0;
  virtual void cancelBounce(int id) = 0;
};

class DockHost {
 public:
  explicit DockHost(std::shared_ptr<DockBackend> backend);

  void setMenu(const folly::dynamic &entries);
  int bounce(bool critical);
  void cancelBounce(int id);
  void menuSelect(const std::string &id);

  std::shared_ptr<void> attach(EventSource::Listener listener);

 private:
  std::shared_ptr<DockBackend> backend_;
  EventSource events_;
  std::mutex mutex_;
  int nextBounce_{1};
  std::set<int> bounces_;
};

std::shared_ptr<NativeModule> makeTrayModule(std::shared_ptr<TrayHost> host);
std::shared_ptr<NativeModule> makeDockModule(std::shared_ptr<DockHost> host);

} // namespace ngn
