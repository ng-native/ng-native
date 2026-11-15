#include "ngn/network-state.h"

#include <mutex>
#include <optional>
#include <vector>

namespace ngn {

folly::dynamic networkStateOf(const NetworkPath &path) {
  const char *type = !path.satisfied ? "NONE"
      : path.wifi                    ? "WIFI"
      : path.ethernet                ? "ETHERNET"
      : path.cellular                ? "CELLULAR"
      : path.other                   ? "OTHER"
                                     : "UNKNOWN";
  return folly::dynamic::object("type", type)("isConnected", path.satisfied)("isInternetReachable", path.satisfied);
}

std::shared_ptr<NativeModule> makeNetworkModule(std::shared_ptr<PathMonitor> monitor) {
  struct Network : NativeModule {
    std::mutex mutex;
    std::optional<NetworkPath> path;
    std::vector<JsPromise> waiting;
    std::function<void()> stop;

    explicit Network(const std::shared_ptr<PathMonitor> &monitor) : NativeModule("NgNativeNetwork") {
      listeners();
      promise("getNetworkStateAsync", [this](const folly::dynamic &, JsPromise promise) {
        std::unique_lock lock(mutex);
        if (!path) {
          waiting.push_back(std::move(promise));
          return;
        }
        auto state = networkStateOf(*path);
        lock.unlock();
        promise.resolve(std::move(state));
      });
      stop = monitor->watch([this](const NetworkPath &next) { changed(next); });
    }

    ~Network() override {
      if (stop) {
        stop();
      }
    }

    void changed(const NetworkPath &next) {
      std::unique_lock lock(mutex);
      bool first = !path.has_value();
      if (!first && *path == next) {
        return;
      }
      path = next;
      auto answered = std::move(waiting);
      waiting.clear();
      lock.unlock();
      auto state = networkStateOf(next);
      for (auto &promise : answered) {
        promise.resolve(state);
      }
      // The first path is what getNetworkStateAsync answers; only a change after it is an event.
      if (!first) {
        emit("ngNativeNetwork", state);
      }
    }
  };
  return std::make_shared<Network>(monitor);
}

} // namespace ngn
