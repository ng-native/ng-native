// The OS half of NgNativeNetwork (the core's network-state.h): Network.framework's path monitor.
#pragma once

#include "ngn/network-state.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<PathMonitor> makePathMonitor();

} // namespace ngn::appkit
