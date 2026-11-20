// A dev run's input script (ngn/input-script.h), replayed into its own window as AppKit events
// through NSApp's sendEvent:, the path the window server's own events take in the app: the local
// monitors, the window, then the view under the pointer. No accessibility grant is needed, since
// nothing is posted to another process.
#pragma once

#include "ngn/input-script.h"

#import <AppKit/AppKit.h>

#include <functional>
#include <string>
#include <utility>

namespace ngn::appkit {

void replayInputScript(NSWindow *window, InputScript script);

// Plays one step into the window now; a wait does nothing.
void playInputStep(NSWindow *window, const InputStep &step);

// The characters and virtual key code a key step's key sends: a named key's, or a character's own
// with no code.
std::pair<NSString *, unsigned short> keyOf(const std::string &key);

// The host's local monitor of scrolls (its back swipe), which a replayed scroll the window takes
// itself (the real pointer being elsewhere) passes first, as NSApp's monitors see a real one. It
// answers the event to send on, or nil to stop it, and is given the window the event is for.
void setReplayScrollMonitor(std::function<NSEvent *(NSEvent *, NSWindow *)> monitor);

} // namespace ngn::appkit
