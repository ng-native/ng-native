// The AppKit half of the worklet host (ngn/worklet-host.h): the main thread as the UI thread, the
// display link that drives the animation frames while they are wanted, and the synchronous view
// updates of the mounting manager.
#pragma once

#include "ngn/mounting-manager.h"

#include <memory>

namespace ngn::appkit {

void installWorkletHost(std::shared_ptr<MountingManager> mounting);

} // namespace ngn::appkit
