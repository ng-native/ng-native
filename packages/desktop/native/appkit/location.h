// The OS half of NgNativeLocation (the core's location.h): CLLocationManager.
#pragma once

#include "ngn/location.h"

#include <memory>

namespace ngn::appkit {

// Made on the main thread, whose run loop CLLocationManager reports on. It asks for the permission
// only where the app's Info.plist explains why (NSLocationUsageDescription or
// NSLocationWhenInUseUsageDescription): without one macOS shows no prompt, so the request answers
// what is decided rather than wait for an answer that never comes.
std::shared_ptr<LocationSource> makeLocationSource();

} // namespace ngn::appkit
