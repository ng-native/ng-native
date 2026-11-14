// What the host runs and how. A dev run (the bare binary `ng-native-desktop run` starts) takes its
// bundle, module, title, app id and capabilities from argv, and settings such as the updates URL
// from the environment. A packaged app (its Info.plist names NGNBundleFile) takes all of them from
// its Info.plist only: argv and the environment are ignored, so nothing launching the app can make
// it run another bundle, as another app, or take updates from another server.
#pragma once

#include "ngn/updates.h"

#include <functional>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace ngn {

struct LaunchSources {
  // argv without the program's own name.
  std::vector<std::string> args;
  using Lookup = std::function<std::optional<std::string>(const std::string &)>;
  // An environment variable.
  Lookup env;
  // A string in the app's Info.plist.
  Lookup plist;
  // The app bundle's Resources folder, where NGNBundleFile is.
  std::string resourcePath;
};

struct LaunchSettings {
  bool packaged{false};
  std::string bundle;
  std::string module{"main"};
  std::string title{"ng-native"};
  std::string appId;
  // A dev run's --capabilities (or NGN_DESKTOP_CAPABILITIES) JSON; a packaged app's are in its
  // Info.plist as NGNCapabilities.
  std::string capabilitiesJson;

  // A setting from the Info.plist key, or in a dev run from the environment variable when the
  // Info.plist has none. Empty when neither has it.
  std::string setting(const std::string &plistKey, const std::string &envName) const;

  LaunchSources::Lookup env;
  LaunchSources::Lookup plist;
};

// The settings, or the usage line when a dev run's argv names no bundle or is malformed.
std::variant<LaunchSettings, std::string> launchSettings(LaunchSources sources);

// The Expo Updates client's settings: NGNUpdatesURL, NGNRuntimeVersion, NGNUpdatesPlatform,
// NGNUpdatesCodeSigningCertificate (PEM), NGNUpdatesCodeSigningKeyId and
// NGNUpdatesCodeSigningAlg, and in a dev run NGN_UPDATES_URL and the rest, as `setting` reads
// them. Updates are kept in `appData`/updates; `embeddedBundle` runs without one. Off (no url)
// without a runtime version.
UpdatesConfig updatesConfigFrom(const LaunchSettings &settings, const std::string &appData, const std::string &embeddedBundle);

} // namespace ngn
