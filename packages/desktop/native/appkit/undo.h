// The app's undo manager (ngn/undo.h) over one NSUndoManager for every window. A focused text
// input keeps its own history: while one is first responder its window answers a manager of its
// own, so Edit > Undo and Cmd-Z reach the app's actions only when no text input has focus.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/undo.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<UndoManager> makeUndoManager();
// What a window's delegate answers from windowWillReturnUndoManager:.
NSUndoManager *undoManagerFor(NSWindow *window);

} // namespace ngn::appkit

// A delegate for a window that needs none but the undo manager (a sheet).
@interface NGNUndoWindowDelegate : NSObject <NSWindowDelegate>
+ (instancetype)shared;
@end
