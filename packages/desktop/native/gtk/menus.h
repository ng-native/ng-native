// The app's menus on GTK (app-menus.h's MenuBackend), from the core's one menu model: a
// GtkPopoverMenuBar under the header bar on KDE Plasma, and the header bar's primary menu
// everywhere else (screens.h lays both slots). Each item is an action of the window's `menu` group,
// which calls `chosen` with the item. GTK's popover menus take no keys of their own, so a key
// press is looked up in the bar (default-menu.h's findMenuItem) by the window's key handling
// (keyPressed), after the app's shortcuts and the back and forward keys, as AppKit's menus come
// after them. The same builder draws a view's context menu.
#pragma once

#include "ngn/app-menus.h"
#include "ngn/default-menu.h"
#include "ngn/input.h"

#include <gtk/gtk.h>

#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <vector>

namespace ngn::gtk {

// A key press as the web names it ("q", "Z" with Shift, "ArrowLeft", "Enter", "F5"), with the
// modifiers held: Ctrl is MenuModifier's Control, Alt its Option, and Super none.
KeyChord chordOf(guint keyval, GdkModifierType state);
// An item's key in GTK's accelerator form ("<Control>q", "<Alt>Left"), for the menu to show; empty
// when it has none.
std::string acceleratorOf(const MenuItem &item);

// `items` as a GMenu whose items are actions of `group`, each named for its place, calling
// `chosen` with its item. Disabled items, and every item in a disabled menu, are disabled actions;
// checked ones are stateful.
GMenuModel *buildMenu(const std::vector<MenuItem> &items, GSimpleActionGroup *group, std::function<void(const MenuItem &)> chosen);

// A popover menu drawing `model`, its submenus nested rather than sliding: a sliding menu opens a
// submenu by its label, so of two submenus with one label the second opened the first.
GtkWidget *nestedPopoverMenu(GMenuModel *model);

class GtkMenus final : public MenuBackend {
 public:
  // `chosen` runs on the UI thread with each item chosen from a menu or by its key.
  explicit GtkMenus(std::function<void(const MenuItem &item)> chosen);
  ~GtkMenus() override;

  void setMenuBar(std::vector<MenuItem> bar) override;
  // A window's chrome (by its surface widget) shows the bar from now on. The UI thread.
  void attach(GtkWidget *surface);
  // The bar as drawn, for a key press to look up. The UI thread.
  const std::vector<MenuItem> &bar() const {
    return bar_;
  }

 private:
  void show(GtkWidget *slot);

  std::function<void(const MenuItem &)> chosen_;
  std::vector<MenuItem> bar_;
  GMenuModel *model_{nullptr};
  GSimpleActionGroup *actions_{nullptr};
  // The menu bars and primary menu buttons showing the bar, each cleared as its window goes.
  std::vector<std::unique_ptr<GtkWidget *>> slots_;
  // Expires as these menus go, for a bar update queued before then.
  std::shared_ptr<void> alive_{std::make_shared<int>(0)};
};

// Linux's Keyboard Shortcuts (MenuHost::keyboardShortcuts's groups), over `parent` when given,
// built through GtkBuilder: libadwaita 1.8's AdwShortcutsDialog, a section a group, where the
// libadwaita running has it, and GTK's GtkShortcutsWindow below 1.8. Not yet shown.
GtkWidget *keyboardShortcutsWindow(const std::vector<ShortcutGroup> &groups, GtkWindow *parent);
// Shows what keyboardShortcutsWindow made: a dialog over its parent, a window on its own.
void presentKeyboardShortcuts(GtkWidget *shortcuts, GtkWindow *parent);

// A view's context menu at `point` in `widget`: chosen items call `chosen`. True once shown.
bool popUpContextMenu(GtkWidget *widget, facebook::react::Point point, const std::vector<MenuItem> &items, std::function<void(const MenuItem &)> chosen);
// The menu a press on `widget` opens, under it from its leading edge, as a GtkMenuButton's opens:
// chosen items call `chosen`. True once shown.
bool popUpMenuUnder(GtkWidget *widget, const std::vector<MenuItem> &items, std::function<void(const MenuItem &)> chosen);

// The window's key handling, in the order AppKit's has it, for a window holding the app's
// surfaces: the app's shortcuts (`shortcut`, true when one took the press), then the focus keys
// (`focus`: Tab, Shift-Tab and a composite widget's arrows, focus.h), then the back and
// forward keys (`navigate`), then a menu item's key (`menuKey`, the item for the press or null).
// A text input that has the focus keeps its own editing keys: an editing command's item's, and any
// item's on a key `editingKey` names (app-menus.h's editingChord). Then, as the press bubbles back up
// unused, Return presses the window's `default` native button and Escape its `cancel` one.
struct KeyRouting {
  std::function<bool(const KeyChord &chord, bool textInputFocused)> shortcut;
  std::function<bool(GtkWindow *window, guint keyval, GdkModifierType state)> focus;
  std::function<std::optional<NavigationDirection>(const KeyChord &chord)> navigation;
  std::function<bool(const KeyChord &chord)> editingKey;
  std::function<void(NavigationDirection direction, GtkWindow *window)> navigate;
  std::function<const MenuItem *(const KeyChord &chord)> menuKey;
  std::function<void(const MenuItem &item, GtkWindow *window)> choose;
};
void routeKeys(GtkWindow *window, std::shared_ptr<KeyRouting> routing);
// Whether the focus in `window` is a text input's, which owns the editing keys.
bool textInputFocused(GtkWindow *window);
// The `default` (Return) or `cancel` (Escape) native button of `window` that is shown and enabled,
// or null.
GtkWidget *keyButton(GtkWindow *window, bool cancel);

} // namespace ngn::gtk
