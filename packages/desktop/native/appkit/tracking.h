// The OS half of NgNativeTrackingTransparency (the core's tracking.h): ATTrackingManager and
// ASIdentifierManager. It asks only when the app's Info.plist has NSUserTrackingUsageDescription.
#pragma once

#include "ngn/tracking.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<TrackingAuthority> makeTrackingAuthority();

} // namespace ngn::appkit
