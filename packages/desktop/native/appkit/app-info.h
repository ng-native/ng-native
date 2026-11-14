// The OS half of NgNativeApplication and NgNativeDevice (the core's app-info.h): the main bundle's
// Info.plist, sysctl, the I/O Registry's product name and the computer name.
#pragma once

#include "ngn/app-info.h"

namespace ngn::appkit {

BundleFacts mainBundleFacts();
MachineFacts machineFacts();

} // namespace ngn::appkit
