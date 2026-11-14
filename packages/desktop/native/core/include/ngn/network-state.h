// NgNativeNetwork: what @ng-native/expo's Network calls on expo-network, over a PathMonitor, which
// the AppKit backend implements with Network.framework's nw_path_monitor.
//
// - getNetworkStateAsync(): {type, isConnected, isInternetReachable}, with expo-network's type
//   names (WIFI, ETHERNET, CELLULAR, OTHER, NONE). It answers once the monitor has reported the
//   first path, which it does at once.
// - `ngNativeNetwork` on DeviceEventEmitter with the same state each time it changes, which the
//   JS adapter turns into addNetworkStateListener's events.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>

namespace ngn {

// The route to the network the OS would use now.
struct NetworkPath {
  // A route exists (nw_path_status_satisfied).
  bool satisfied{false};
  // The interface types the path uses.
  bool wifi{false};
  bool ethernet{false};
  bool cellular{false};
  bool other{false};
  bool operator==(const NetworkPath &) const = default;
};

class PathMonitor {
 public:
  virtual ~PathMonitor() = default;
  // Reports the path now and on each change, on any thread, until the answer is called.
  virtual std::function<void()> watch(std::function<void(const NetworkPath &)> changed) = 0;
};

// expo-network's NetworkState for a path.
folly::dynamic networkStateOf(const NetworkPath &path);

std::shared_ptr<NativeModule> makeNetworkModule(std::shared_ptr<PathMonitor> monitor);

} // namespace ngn
