// Where the keyboard focus goes back to when a sheet, cover or popover closes: the view that held
// it when the presentation opened, if it is still in its window.
#pragma once

#import <AppKit/AppKit.h>

namespace ngn::appkit {

// The view holding the keyboard focus in `window`: its first responder, or for a field editor the
// text field it edits. Nil when the window itself, or nothing, has it.
NSView *focusHolder(NSWindow *window);

// Gives the focus back to `holder` when it is still in `window` and takes it. True when it did.
bool returnFocus(NSWindow *window, NSView *holder);

} // namespace ngn::appkit
