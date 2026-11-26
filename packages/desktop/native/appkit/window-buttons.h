// The window controls (close, minimise and zoom) placed where `trafficLightPosition` asks, as
// Electron's option of that name places them.
#pragma once

#include "ngn/app-windows.h"

#import <AppKit/AppKit.h>

namespace ngn::appkit {

// Moves `window`'s close button's top-left to `position`, in points from the window's top-left,
// with the minimise and zoom buttons beside it at the system's spacing, and makes the title bar
// tall enough to hold them there. Does nothing in full screen, where the system keeps them in the
// menu bar's title bar, or for a window without them.
void placeWindowButtons(NSWindow *window, const WindowButtonsPosition &position);

} // namespace ngn::appkit
