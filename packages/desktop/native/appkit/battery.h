// The OS half of NgNativeBattery (the core's battery.h): IOKit's power sources and NSProcessInfo's
// Low Power Mode.
#pragma once

#include "ngn/battery.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<PowerSource> makePowerSource();

} // namespace ngn::appkit
