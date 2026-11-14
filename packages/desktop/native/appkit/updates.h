// The OS half of the Expo Updates client (the core's updates.h): SHA-256 and the manifest's
// signature over CommonCrypto and Security, and the client's settings.
#pragma once

#include "ngn/updates.h"

#include <memory>
#include <string>

namespace ngn::appkit {

std::shared_ptr<UpdateCrypto> makeUpdateCrypto();

// Sparkle, in a packaged `dmg` build with a feed (app-updater.mm); null anywhere else.
std::shared_ptr<AppUpdater> makeSparkleUpdater();

// The client's settings: from a packaged app's Info.plist (NGNUpdatesURL, NGNRuntimeVersion,
// NGNUpdatesPlatform, and the code signing certificate as PEM in NGNUpdatesCodeSigningCertificate
// with NGNUpdatesCodeSigningKeyId and NGNUpdatesCodeSigningAlg), otherwise from the environment
// variables of the same names in capitals and underscores (NGN_UPDATES_URL and so on), for a
// bundle run from disk. Updates are kept in `appData`/updates; `embeddedBundle` runs without one.
UpdatesConfig updatesConfig(const std::string &appData, const std::string &embeddedBundle);

} // namespace ngn::appkit
