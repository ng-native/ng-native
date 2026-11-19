// The GTK half of the worklet host (ngn/worklet-host.h), as appkit/animation-frames.h is AppKit's:
// GTK's main thread as the UI thread, a window's frame clock driving the animation frames while
// they are wanted, and the synchronous view updates of the mounting manager.
#pragma once

#include "gtk-backend.h"

#include "ngn/mounting-manager.h"

#include <memory>

namespace ngn::gtk {

void installWorkletHost(std::shared_ptr<MountingManager> mounting, std::shared_ptr<GtkBackend> backend);

// Starts or stops the frames as the host's `frames.wanted()` says. UI thread. The installed host
// calls it each time that changes; a test calls it to drive the frames itself.
void updateAnimationFrames();

} // namespace ngn::gtk
