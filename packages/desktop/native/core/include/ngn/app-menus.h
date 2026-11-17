// The app's menus and shortcuts: the `NgNativeMenus` module, the menu bar and context menu entries
// as the app sends them (`NativeMenuEntry` in @ng-native/device), the shortcuts it listens for, and
// the OS's back and forward inputs mapped to `navigate`.
//
// The bar the app sends is the whole merged bar, its defaults included. An item with a `menuRole`
// is the OS's own command unless the app marks it `handled`; every other item is the app's, and
// choosing it sends `menuSelect` with its id. Shortcuts match a key press before the menus see it;
// one on an editing key (Cmd-Z, X, C, V, A) still goes on to a focused text input, which owns it.
#pragma once

#include "ngn/default-menu.h"
#include "ngn/host-state.h"
#include "ngn/native-module.h"

#include <react/renderer/core/ReactPrimitives.h>

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

using facebook::react::SurfaceId;

// A key press: the key as the web names it (a character, or "ArrowLeft", "Enter", "F5"...) and the
// modifiers held (MenuModifier).
struct KeyChord {
  std::string key;
  unsigned modifiers{0};
  bool operator==(const KeyChord &) const = default;
};

// The entries of a menu as the app sends them (a context menu's, or one group's items).
std::vector<MenuItem> parseMenu(const folly::dynamic &entries);
// The app's whole bar, with the host's Developer menu before Help when `options.developer`.
std::vector<MenuItem> parseMenuBar(const folly::dynamic &groups, const DefaultMenuOptions &options);
// `{ key, meta, ctrl, alt, shift }`, as `parseShortcut` reads a shortcut for macOS.
KeyChord parseChord(const folly::dynamic &chord);

enum class NavigationDirection { Back, Forward };
enum class NavigationInput { MouseButton4, MouseButton5, SwipeLeft, SwipeRight };

// The OS's back and forward inputs: mouse buttons 4 and 5, a swipe (right goes back, as a page
// follows the fingers), and Cmd-[ and Cmd-]. Cmd-Left stays with text editing.
std::optional<NavigationDirection> navigationFor(NavigationInput input);
std::optional<NavigationDirection> navigationFor(const KeyChord &chord);

// A window's back and forward history, as the app's router reports it (`setHistory`): the titles
// of the entries behind and ahead, nearest first.
struct WindowHistory {
  std::vector<std::string> back;
  std::vector<std::string> forward;
  bool operator==(const WindowHistory &) const = default;
};

// The back and forward chevrons leading a window's toolbar.
struct HistoryButtons {
  bool shown{false};
  bool backEnabled{false};
  bool forwardEnabled{false};
  // Whether a click goes through the window's history (`navigate`), rather than popping the stack
  // in front (an app that reports no history).
  bool fromHistory{false};
  bool operator==(const HistoryButtons &) const = default;
};

// The pair shows when the window has history, or, for an app that reports none, when the stack in
// front has a screen below (back only). The header's `hideBackButton` hides it, and its own left
// items replace it.
HistoryButtons historyButtons(const std::optional<WindowHistory> &history, bool stackCanGoBack, bool hidden);

// The list a long press or a secondary click on a chevron shows: the entries that way, nearest
// first, each with how many steps it is.
struct HistoryMenuItem {
  std::string title;
  int steps{1};
  bool operator==(const HistoryMenuItem &) const = default;
};
std::vector<HistoryMenuItem> historyMenu(const WindowHistory &history, NavigationDirection direction);

// Which chevron a point `x` across the pair (`width` wide) is on: back leads, so it is the left
// one, and the right one in a right-to-left layout.
NavigationDirection chevronAt(double x, double width, bool rightToLeft);

class MenuBackend {
 public:
  virtual ~MenuBackend() = default;
  // Draw `bar` as the menu bar, in place of the one before. Any thread.
  virtual void setMenuBar(std::vector<MenuItem> bar) = 0;
};

class MenuHost {
 public:
  using Listener = std::function<void(const folly::dynamic &event)>;

  // Draws the default menu bar at once.
  MenuHost(std::shared_ptr<MenuBackend> backend, DefaultMenuOptions options);

  const DefaultMenuOptions &options() const {
    return options_;
  }

  // --- what the app sends ---
  void setMenuBar(const folly::dynamic &groups);
  void setShortcuts(const folly::dynamic &shortcuts);

  // --- what the OS reports ---
  // A menu bar item was chosen in the window on `surface` (the key window's, or nothing). Print
  // with no handler of the app's prints that window (`printWindow`).
  void choose(const MenuItem &item, std::optional<SurfaceId> surface);
  // What File > Print does when the app has no print item of its own: prints the window on the
  // surface, or the key window when it has none. Set once by the host.
  std::function<void(std::optional<SurfaceId> surface)> printWindow;
  // A key press, before the menus and the focused view see it. True when the app's shortcut takes
  // it, and the press goes no further.
  bool keyDown(const KeyChord &chord, bool textInputFocused);
  // Back or forward `steps` entries (one, but for a pick from the history menu).
  void navigate(NavigationDirection direction, std::optional<SurfaceId> surface, int steps = 1);

  // --- the windows' history, as the app reports it ---
  void setHistory(SurfaceId surface, WindowHistory history);
  // Nothing for a window the app reported none for.
  std::optional<WindowHistory> history(SurfaceId surface) const;
  // A window closed: its history goes with it.
  void forgetHistory(SurfaceId surface);
  // Told, on the thread `setHistory` came on, of a window whose history changed. Set once.
  std::function<void(SurfaceId)> historyChanged;

  std::shared_ptr<void> listen(Listener listener);

 private:
  void send(const folly::dynamic &event);

  std::shared_ptr<MenuBackend> backend_;
  DefaultMenuOptions options_;
  mutable std::mutex mutex_;
  std::vector<std::pair<std::string, KeyChord>> shortcuts_;
  std::map<SurfaceId, WindowHistory> histories_;
  // A dropped handle waits for its listener's call in progress, so a module going with a reload
  // is never called after.
  Listeners<folly::dynamic> listeners_;
};

std::shared_ptr<NativeModule> makeMenusModule(std::shared_ptr<MenuHost> host);

} // namespace ngn
