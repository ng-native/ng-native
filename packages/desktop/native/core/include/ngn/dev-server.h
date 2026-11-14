// The Metro dev server a bundle URL points at. The desktop host loads the bundle URL directly
// (never the Expo manifest, which the Expo dev server refuses for macos), then keeps a connection
// to the same server for reload (/message) and Fast Refresh (the HMR client, over /hot).
#pragma once

#include <folly/dynamic.h>

#include <cstdint>
#include <optional>
#include <string>

namespace ngn {

struct DevServer {
  // `url` when it is an http or https URL with a host, otherwise nothing (a bundle on disk).
  static std::optional<DevServer> fromBundleUrl(const std::string &url);

  std::string bundleUrl;
  std::string scheme;
  std::string host;
  uint32_t port{0};
  // The bundle's path without its leading slash and `.bundle`, as HMRClient.setup takes it.
  std::string entry;
  // The `platform` query parameter; `macos` when the URL has none.
  std::string platform;

  // Where Metro sends reload and dev menu messages.
  std::string packagerConnectionUrl() const;
  // HMRClient.setup(platform, bundleEntry, host, port, isEnabled, scheme).
  folly::dynamic hmrSetupArgs() const;
};

} // namespace ngn
