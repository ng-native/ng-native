// Tab and Shift-Tab in a window: the order is the core's (focus-order.h), walked over the
// container the focus is in, in place of AppKit's key-view loop.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/focus-order.h"

@class NGNSurfaceView;
@class NGNView;

namespace ngn::appkit {

class AppKitBackend;

// The container the focus is in, and the view holding it, in `window`. An in-window cover (a modal)
// is the container while it is up, wherever the first responder is: Tab stays inside it.
struct FocusContext {
  NGNSurfaceView *container = nil;
  NGNView *focused = nil;
};

FocusContext focusContext(NSWindow *window);

// Moves the focus in `window` to the next view in Tab order (the previous with `backwards`), over
// the views `backend` mounted for `tree`. A view that will not take the focus (a disabled control,
// or a field AppKit refuses it to) is passed over. True when the key is used: the focus moved,
// or it is inside a sheet, cover or popover, which Tab never leaves.
bool moveFocus(NSWindow *window, const ViewTree &tree, const AppKitBackend &backend, bool backwards, TabReach reach);

} // namespace ngn::appkit
