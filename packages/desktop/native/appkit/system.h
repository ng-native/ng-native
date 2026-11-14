// The core's System interface over AppKit and Foundation.
#pragma once

#include "ngn/host-state.h"
#include "ngn/system.h"

#include <memory>
#include <string>

namespace ngn::appkit {

// `appId` names the app's data directory until the app has a bundle identifier of its own.
std::shared_ptr<System> makeSystem(std::string appId);

// Keeps `state` in step with the app: activity, the colour scheme, and URLs from Apple Events.
// Main thread, once, before the app finishes launching (a launch URL then becomes the initial URL).
void watchApp(std::shared_ptr<HostState> state, std::shared_ptr<System> system);

} // namespace ngn::appkit
