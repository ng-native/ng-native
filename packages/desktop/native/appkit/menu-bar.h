// The core's default menu bar as NSApp's main menu. Commands AppKit knows go to the responder
// chain (so Copy reaches the focused field); the rest go to `handler`.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/default-menu.h"

#include <functional>
#include <vector>

namespace ngn::appkit {

void installMenuBar(const std::vector<MenuItem> &menus, std::function<void(MenuCommand)> handler);

} // namespace ngn::appkit
