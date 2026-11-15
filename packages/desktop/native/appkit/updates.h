// The OS half of the Expo Updates client (the core's updates.h): SHA-256 and the manifest's
// signature over CommonCrypto and Security. Its settings are the core's (launch-settings.h).
#pragma once

#include "ngn/updates.h"

#include <memory>
#include <string>

namespace ngn::appkit {

std::shared_ptr<UpdateCrypto> makeUpdateCrypto();

// Sparkle, in a packaged `dmg` build with a feed (app-updater.mm); null anywhere else.
std::shared_ptr<AppUpdater> makeSparkleUpdater();

} // namespace ngn::appkit
