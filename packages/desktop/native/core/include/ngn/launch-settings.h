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

// A test launch: `vitest --project macos` through @ng-native/testing starts a dev run with
// NGN_TESTS=1, NGN_STATE_DIR (a new empty directory), NGN_RUN_ID (unique to the launch) and
// NGN_TESTS_FAKE_SYSTEM_UI=1. The host keeps every piece of state under the state directory or
// named by the run id, so a run starts with none of an earlier one and leaves none behind, and
// opens its windows without taking focus. A packaged app is never a test launch.
struct TestLaunch {
  std::string stateDir;
  std::string runId;
  // System UI (panels, permission prompts, Touch ID, alerts) answers as a person cancelling would.
  bool fakeSystemUI{false};

  std::string applicationSupport() const { return stateDir + "/Application Support"; }
  std::string caches() const { return stateDir + "/Caches"; }
  std::string temp() const { return stateDir + "/tmp"; }
  // The UserDefaults suite the app's preferences go in.
  std::string defaultsSuite() const { return keychainPrefix() + "defaults"; }
  // What every Keychain service the app uses is prefixed with.
  std::string keychainPrefix() const { return "ngn-test-" + runId + "."; }
};

// Whether a Keychain service belongs to another test launch, one that ended without removing its
// items (a crash): prefixed `ngn-test-` and not `own`'s.
bool isStaleTestService(const std::string &service, const TestLaunch &own);

struct LaunchSettings {
  bool packaged{false};
  std::string bundle;
  std::string module{"main"};
  std::string title{"ng-native"};
  std::string appId;
  // A dev run's --capabilities (or NGN_DESKTOP_CAPABILITIES) JSON; a packaged app's are in its
  // Info.plist as NGNCapabilities.
  std::string capabilitiesJson;
  // Set for a test launch.
  std::optional<TestLaunch> test;
  // No system prompt is ever shown (NGN_NO_PROMPTS=1, or a test launch's fake system UI): a
  // permission not decided reads as denied, and a sign-in or Touch ID as cancelled.
  bool noPrompts{false};

  // A setting from the Info.plist key, or in a dev run from the environment variable when the
  // Info.plist has none. Empty when neither has it.
  std::string setting(const std::string &plistKey, const std::string &envName) const;

  LaunchSources::Lookup env;
  LaunchSources::Lookup plist;
};

// The settings, or the usage line when a dev run's argv names no bundle or is malformed, or why a
// test launch's environment is unusable (NGN_TESTS=1 without an absolute NGN_STATE_DIR, or with a
// run id that is not letters, digits and dashes).
std::variant<LaunchSettings, std::string> launchSettings(LaunchSources sources);

// The Expo Updates client's settings: NGNUpdatesURL, NGNRuntimeVersion, NGNUpdatesPlatform,
// NGNUpdatesCodeSigningCertificate (PEM), NGNUpdatesCodeSigningKeyId and
// NGNUpdatesCodeSigningAlg, and in a dev run NGN_UPDATES_URL and the rest, as `setting` reads
// them. Updates are kept in `appData`/updates; `embeddedBundle` runs without one. Off (no url)
// without a runtime version.
UpdatesConfig updatesConfigFrom(const LaunchSettings &settings, const std::string &appData, const std::string &embeddedBundle);

} // namespace ngn
