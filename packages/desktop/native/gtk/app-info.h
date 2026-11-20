// The OS half of NgNativeDevice on Linux (the core's app-info.h): the firmware's maker and product
// (DMI, under /sys/class/dmi/id), the distribution's os-release (the host's, from inside a
// Flatpak), the kernel's release, the host name, memory and the CPU's architecture.
// NgNativeApplication's facts are the package's metadata.json (bundleFactsOf).
#pragma once

#include "ngn/app-info.h"

#include <string>

namespace ngn::gtk {

// `root` stands for / in the paths read, for the tests.
MachineFacts machineFacts(const std::string &root = "");

// The distribution as PlatformConstants names it (Platform.constants on Linux): os-release's NAME
// ("Ubuntu", or "Linux" where it has none, as os-release defaults it) and VERSION_ID ("24.04", or
// empty on a rolling release, which has none). Read as machineFacts reads it.
struct DistroRelease {
  std::string name;
  std::string versionId;
};
DistroRelease distroRelease(const std::string &root = "");

} // namespace ngn::gtk
