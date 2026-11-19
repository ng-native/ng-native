// The OS half of NgNativeBattery on Linux (the core's battery.h): UPower's DisplayDevice, the
// battery the desktop shows, and whether the machine runs on battery; low power from the
// PowerProfileMonitor portal, else power-profiles-daemon's active profile. With no UPower the
// machine has no battery as far as the app can tell, and isAvailableAsync answers false.
#pragma once

#include "ngn/battery.h"

#include <gio/gio.h>

#include <memory>

namespace ngn::gtk {

// Made on the main context. `connection`, in the tests, is a peer-to-peer connection to stand-in
// services, used for every object in place of the system and session buses.
std::shared_ptr<PowerSource> makePowerSource(GDBusConnection *connection = nullptr);

} // namespace ngn::gtk
