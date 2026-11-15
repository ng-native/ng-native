// The core's System interface over AppKit and Foundation.
#pragma once

#include "ngn/host-state.h"
#include "ngn/system.h"

#include <functional>
#include <memory>
#include <string>

namespace ngn::appkit {

// Has VoiceOver say `announcement`, from any thread (on the main one).
void postAnnouncement(const Announcement &announcement);

// `appId` names the app's data directory until the app has a bundle identifier of its own.
std::shared_ptr<System> makeSystem(std::string appId);

// Keeps `state` in step with the app: activity, the colour scheme, the accessibility settings, and
// URLs from Apple Events.
// Main thread, once, before the app finishes launching (a launch URL then becomes the initial URL).
void watchApp(std::shared_ptr<HostState> state, std::shared_ptr<System> system);

// Tells `read` the colour scheme on the main thread each time clearing the override reads the
// system's again, which watchApp publishes to the host state. `system` is makeSystem's.
void onSchemeRead(const std::shared_ptr<System> &system, std::function<void(std::string)> read);

} // namespace ngn::appkit
