// What the host runs and how. A dev run (the bare binary `ng-native-desktop run` starts) takes its
// bundle, module, title, app id and capabilities from argv, and settings such as the updates URL
// from the environment. A packaged app (its Info.plist names NGNBundleFile) takes all of them from
// its Info.plist only: argv and the environment are ignored, so nothing launching the app can make
// it run another bundle, as another app, or take updates from another server. A Linux package has
// no Info.plist: the same keys are in the metadata.json beside its host (packagedMetadata).
#pragma once

#include "ngn/host-os.h"
#include "ngn/updates.h"

#include <functional>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace ngn {

// The switch the session bus starts a D-Bus activatable app with (GApplication's own).
inline constexpr const char *kDBusServiceArg = "--gapplication-service";

struct LaunchSources {
  // argv without the program's own name.
  std::vector<std::string> args;
  using Lookup = std::function<std::optional<std::string>(const std::string &)>;
  // An environment variable.
  Lookup env;
  // A string in the app's Info.plist, or its Linux package's metadata.json.
  Lookup plist;
  // The app bundle's Resources folder, where NGNBundleFile is: on Linux, the folder holding the
  // host, the bundle and metadata.json.
  std::string resourcePath;
};

// The metadata.json in `folder`, the folder of a Linux package's host (bin/package-linux.mjs), as a
// lookup for LaunchSources::plist: a string value as it is, any other (NGNCapabilities' object) as
// its JSON. An empty lookup when there is no such file, as in a dev run; why, when the file is there
// but is not a JSON object, so a broken package says so rather than running as a dev build.
std::variant<LaunchSources::Lookup, std::string> packagedMetadata(const std::string &folder);

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
  // A dev run's --capabilities (or NGN_DESKTOP_CAPABILITIES) JSON. A packaged app's are its
  // NGNCapabilities: here when its lookup gives them as JSON (metadata.json); a macOS app reads its
  // Info.plist's dictionary itself.
  std::string capabilitiesJson;
  // A dev run's NGN_DESKTOP_ICON: the app's icon image, which the host shows for the app (a bare
  // executable has no bundle to take one from). Empty when none; a packaged app's is its bundle's.
  std::string icon;
  // A dev run's --url: the link the app opens as it launches (Linking's initial URL), as a click on
  // a link to the app's scheme would. Empty when none; a packaged app is opened on a link by the OS.
  std::string initialUrl;
  // What a packaged Linux app was opened on: the links and files its desktop entry's `%U` passes,
  // as given (a URL, or a file's path).
  std::vector<std::string> openArgs;
  // `--gapplication-service`: started by the session bus as the app's D-Bus service, which a
  // desktop entry with DBusActivatable=true asks for.
  bool dbusService{false};
  // Set for a test launch.
  std::optional<TestLaunch> test;
  // No system prompt is ever shown (NGN_NO_PROMPTS=1, or a test launch's fake system UI): a
  // permission not decided reads as denied, and a sign-in or Touch ID as cancelled.
  bool noPrompts{false};
  // A dev run's switches, never a packaged app's: NGN_INPUT_SCRIPT, the input script played into
  // the first window (input-script.h); NGN_LOG_ROTORS=1, the window's rotor items logged a second
  // after the first frame; NGN_LOG_COMMITS=1, each commit's time logged.
  std::string inputScript;
  bool logRotors{false};
  bool logCommits{false};

  // A setting from the Info.plist key, or in a dev run from the environment variable when the
  // Info.plist has none. Empty when neither has it.
  std::string setting(const std::string &plistKey, const std::string &envName) const;

  LaunchSources::Lookup env;
  LaunchSources::Lookup plist;
};

// The settings, or the usage line (naming `os`'s program) when a dev run's argv names no bundle or
// is malformed, or why a test launch's environment is unusable (NGN_TESTS=1 without an absolute
// NGN_STATE_DIR, or with a run id that is not letters, digits and dashes).
std::variant<LaunchSettings, std::string> launchSettings(LaunchSources sources, const HostOs &os);

// The Expo Updates client's settings: NGNUpdatesURL, NGNRuntimeVersion, NGNUpdatesPlatform,
// NGNUpdatesCodeSigningCertificate (PEM), NGNUpdatesCodeSigningKeyId and
// NGNUpdatesCodeSigningAlg, and in a dev run NGN_UPDATES_URL and the rest, as `setting` reads
// them. The platform is `os`'s id without NGNUpdatesPlatform. Updates are kept in `appData`/updates;
// `embeddedBundle` runs without one. Off (no url) without a runtime version.
UpdatesConfig updatesConfigFrom(
    const LaunchSettings &settings, const HostOs &os, const std::string &appData, const std::string &embeddedBundle);

} // namespace ngn
