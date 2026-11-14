// The Expo Updates protocol client (protocol version 1), for bundle-only updates from a
// self-hosted server: EAS Update refuses `macos`, and the iOS client is Swift over RCT and
// ExpoModulesCore, neither of which the desktop host has. Toolkit-free: requests go through the
// Http interface (network.h), the hash and the signature through UpdateCrypto, which a backend
// implements over the OS's own (CommonCrypto and Security on macOS), and files through
// std::filesystem under the app's data directory.
//
// - check: GET the server's URL with the protocol's headers (platform, runtime version, the
//   running update's id, and the signature expected when code signing is on). The answer is a
//   manifest, or a directive (`noUpdateAvailable`, `rollBackToEmbedded`), as JSON or as
//   multipart/mixed. A manifest is an update only when its runtime version is this build's, it is
//   not the running update nor one that failed to launch, and, with code signing on, its
//   `expo-signature` verifies against the certificate (RSASSA-PKCS1-v1_5 over SHA-256).
// - fetch: downloads the checked update's launch asset and keeps it only when its SHA-256 is the
//   manifest's `hash` (base64url). The update becomes the one the next launch runs.
// - launch: what the host loads at startup, the newest kept update or the embedded bundle. A launch
//   of a downloaded update is marked before it starts and cleared once it has run for a while
//   (markLaunchSucceeded); a marker still set at the next startup means that launch crashed, so the
//   update is marked failed and the one before it, or the embedded bundle, runs instead. Expo's own
//   recovery covers JavaScript errors only; a native crash needs this marker.
//
// Only the launch asset is downloaded: a bundle that loads its other assets from the server by URL
// works, and assets packaged with the app keep working, but a new asset only in the update does not.
#pragma once

#include "ngn/network.h"

#include <folly/dynamic.h>

#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

class UpdateCrypto {
 public:
  virtual ~UpdateCrypto() = default;
  // The SHA-256 digest of `bytes`, as 32 raw bytes.
  virtual std::string sha256(const std::string &bytes) = 0;
  // Whether `signature` (raw bytes) is an RSASSA-PKCS1-v1_5 SHA-256 signature of `data` by the key
  // of the PEM certificate `certificatePem`. False for a certificate that does not parse.
  virtual bool verifyRsaSha256(const std::string &certificatePem, const std::string &data, const std::string &signature) = 0;
};

struct UpdatesConfig {
  // The server's manifest URL (Expo's `updates.url`). Empty turns updates off.
  std::string url;
  std::string runtimeVersion;
  // The `expo-platform` header. EAS Update refuses `macos`; a self-hosted server serves it.
  std::string platform{"macos"};
  // The certificate a manifest must be signed by, as PEM, with its `keyid` and `alg`
  // (Expo's `updates.codeSigningCertificate` and `codeSigningMetadata`). Empty: no code signing.
  std::string certificatePem;
  std::string keyId{"main"};
  std::string algorithm{"rsa-v1_5-sha256"};
  // Where downloaded updates and the launch state are kept.
  std::filesystem::path directory;
  // The bundle packaged with the app, which runs when no update does.
  std::string embeddedBundle;
};

// base64url without padding, as the protocol writes a hash.
std::string base64Url(const std::string &bytes);

// A Structured Field Values dictionary of strings, as `expo-signature` is: `sig="...", keyid="main"`.
// Nothing when it does not parse.
std::optional<std::map<std::string, std::string>> parseSignatureHeader(const std::string &header);

struct UpdateManifest {
  std::string id;
  std::string createdAt;
  std::string runtimeVersion;
  std::string launchUrl;
  std::string launchHash;
  // The manifest as the server sent it, which JavaScript gets.
  folly::dynamic raw;
};

// What a server answers a check with.
struct UpdateResponse {
  std::optional<UpdateManifest> manifest;
  // The manifest's bytes as sent, which its signature covers.
  std::string manifestBody;
  // Its `expo-signature` header, empty when it has none.
  std::string signature;
  // `noUpdateAvailable` or `rollBackToEmbedded`, or empty.
  std::string directive;
  // The directive's bytes as sent, and its part's `expo-signature`, which covers them.
  std::string directiveBody;
  std::string directiveSignature;
};

// Reads a response body as the protocol allows it: a manifest as JSON (`application/json` or
// `application/expo+json`), or `multipart/mixed` with `manifest`, `directive` and `extensions`
// parts. Throws std::runtime_error naming what is wrong.
UpdateResponse parseUpdateResponse(const Headers &headers, const std::string &body);

// What the client keeps between launches, in `state.json` in its directory.
struct LaunchState {
  struct Update {
    std::string id;
    std::string createdAt;
    std::string runtimeVersion;
    // The launch asset, relative to the directory.
    std::string file;
    bool operator==(const Update &) const = default;
  };
  std::optional<Update> current;
  std::optional<Update> previous;
  // Updates that crashed on launch, never run or offered again.
  std::vector<std::string> failed;
  // The update whose launch has not yet been marked a success.
  std::string launching;
};

class UpdatesClient {
 public:
  UpdatesClient(UpdatesConfig config, std::shared_ptr<Http> http, std::shared_ptr<UpdateCrypto> crypto);

  bool enabled() const {
    return !config_.url.empty();
  }
  const UpdatesConfig &config() const {
    return config_;
  }

  // The bundle to load at startup, recovering from a launch that crashed (see above), and marking
  // this launch. Call once, before the runtime starts.
  std::string launch();
  // This launch ran long enough to count, or the app quit cleanly: an update that crashes after it
  // is not rolled back.
  void markLaunchSucceeded();
  // The same, only when `generation` is still the current launch's: a timer armed for a launch a
  // reload has since replaced marks nothing.
  void markLaunchSucceeded(uint64_t generation);
  // Which launch is current; launch() and beginReload() each begin a new one.
  uint64_t launchGeneration() const;
  // The update this launch runs, or nothing for the embedded bundle.
  std::optional<LaunchState::Update> running() const;

  struct CheckResult {
    bool isAvailable{false};
    bool isRollBackToEmbedded{false};
    folly::dynamic manifest{nullptr};
    // Why the check failed; empty when it did not.
    std::string error;
  };
  // Asks the server. `done` may run on any thread.
  void check(std::function<void(CheckResult)> done);

  struct FetchResult {
    bool isNew{false};
    bool isRollBackToEmbedded{false};
    folly::dynamic manifest{nullptr};
    std::string error;
  };
  // Downloads what the last check found, which the next launch (or reload) runs.
  void fetch(std::function<void(FetchResult)> done);

  // The bundle a reload now runs: the fetched update, or the embedded bundle after a rollback.
  std::string bundleToRun() const;
  // Marks that bundle's launch, as launch() does, and answers it, for a reload into it.
  std::string beginReload();

  LaunchState state() const;

 private:
  LaunchState load() const;
  void save(const LaunchState &state) const;
  std::string pathOf(const LaunchState::Update &update) const;
  bool usable(const LaunchState::Update &update, const LaunchState &state) const;
  void markLocked();
  // Why a manifest's (or the `what` named) signature header does not verify its bytes, when the
  // app requires signing.
  std::optional<std::string> signatureProblem(
      const std::string &body, const std::string &header, const std::string &what = "manifest") const;

  UpdatesConfig config_;
  std::shared_ptr<Http> http_;
  std::shared_ptr<UpdateCrypto> crypto_;
  mutable std::mutex mutex_;
  std::optional<LaunchState::Update> running_;
  // What the last check found.
  std::optional<UpdateManifest> found_;
  std::string foundBody_;
  uint64_t generation_{0};
  std::string foundSignature_;
  bool foundRollBack_{false};
  std::shared_ptr<HttpTask> task_;
};

// The whole-app updater: Sparkle, in a `dmg` build only (the Mac App Store updates a `mas` build,
// and an `app` build has none).
class AppUpdater {
 public:
  virtual ~AppUpdater() = default;
  // Checks now, with the updater's own window.
  virtual void check() = 0;
  // Whether a background check found an update.
  virtual bool updateAvailable() = 0;
  // Told when a check finds an update, or finds none. One listener: a later one replaces it.
  virtual void onUpdateAvailable(std::function<void(bool available)> listener) = 0;
};

class NativeModule;
// NgNativeUpdates: what @ng-native/expo's Updates calls on expo-updates. `isEnabled`, `updateId`,
// `runtimeVersion` and `isEmbeddedLaunch` as properties; checkForUpdateAsync, fetchUpdateAsync and
// reloadAsync, which resolves and then restarts the runtime on the fetched bundle through `reload`
// (the promise's runtime does not outlive the reload). Disabled (every
// call refused) in development, where the bundle comes from Metro.
//
// The whole-app half, over `appUpdater`: the `isAppUpdaterAvailable` property, isAppUpdateAvailable,
// checkForAppUpdateAsync (true once the updater's window is up) and the `appUpdateAvailable` event
// ({available}). Without an updater it is absent: the property is false and the calls answer false.
std::shared_ptr<NativeModule> makeUpdatesModule(
    std::shared_ptr<UpdatesClient> client,
    bool development,
    std::function<void(const std::string &bundle, std::function<void(bool)> done)> reload,
    std::shared_ptr<AppUpdater> appUpdater = nullptr);

} // namespace ngn
