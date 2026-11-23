// Menus from the core's MenuItem model (default-menu.h, app-menus.h): the menu bar as NSApp's main
// menu, and a context menu. Commands AppKit knows go to the responder chain (so Copy reaches the
// focused field, and is disabled when nothing can copy); the rest go to `chosen`.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/default-menu.h"

#include <functional>
#include <vector>

namespace ngn::appkit {

using MenuChosen = std::function<void(const MenuItem &)>;

void installMenuBar(const std::vector<MenuItem> &menus, MenuChosen chosen);
NSMenu *buildMenu(const std::string &title, const std::vector<MenuItem> &items, MenuChosen chosen);
// Where the menu a press on `view` opens goes, in the view's coordinates: its top just under the
// view's bottom edge and its leading edge on the view's, as a pull-down button's menu opens.
NSPoint menuLocationUnder(NSView *view);
// Opens `menu` there, laid out in the view's direction. Returns once the menu closes.
void popUpMenuUnder(NSMenu *menu, NSView *view);
// The key equivalent AppKit takes for a key the web names ("ArrowLeft", "F5", "Enter", "q").
NSString *keyEquivalent(const std::string &key);

} // namespace ngn::appkit
