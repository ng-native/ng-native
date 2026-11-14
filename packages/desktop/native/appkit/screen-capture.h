// The OS half of NgNativeScreenCapture (the core's screen-capture.h): NSWindow.sharingType on every
// window of the app. A window opened while capture is prevented is kept out from its first update,
// and the host's own windows (AppWindows and modal sheets) from the moment they are made.
#pragma once

#include "ngn/screen-capture.h"

#include <memory>

@class NSWindow;

namespace ngn::appkit {

// One per process: the windows are the process's.
std::shared_ptr<CaptureShield> captureShield();

// Applies the shield's state to a window the host has just made, before it is shown.
void shieldNewWindow(NSWindow *window);

} // namespace ngn::appkit
