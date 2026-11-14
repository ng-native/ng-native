// The OS half of the desktop Expo modules (the core's desktop-expo.h).
#pragma once

#include "ngn/desktop-expo.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<SecretStore> makeKeychain();
std::shared_ptr<SleepPreventer> makeSleepPreventer();
std::shared_ptr<HapticPlayer> makeHapticPlayer();

} // namespace ngn::appkit
