// A dev run's input script (ngn/input-script.h), replayed into its own window as AppKit events
// through NSApp's sendEvent:, the path the window server's own events take in the app: the local
// monitors, the window, then the view under the pointer. No accessibility grant is needed, since
// nothing is posted to another process.
#pragma once

#include "ngn/input-script.h"

#import <AppKit/AppKit.h>

namespace ngn::appkit {

void replayInputScript(NSWindow *window, InputScript script);

// Plays one step into the window now; a wait does nothing.
void playInputStep(NSWindow *window, const InputStep &step);

} // namespace ngn::appkit
