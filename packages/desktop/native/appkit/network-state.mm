#include "network-state.h"

#import <Network/Network.h>

namespace ngn::appkit {

namespace {

NetworkPath pathOf(nw_path_t path) {
  return {
      .satisfied = nw_path_get_status(path) == nw_path_status_satisfied,
      .wifi = nw_path_uses_interface_type(path, nw_interface_type_wifi),
      .ethernet = nw_path_uses_interface_type(path, nw_interface_type_wired),
      .cellular = nw_path_uses_interface_type(path, nw_interface_type_cellular),
      .other = nw_path_uses_interface_type(path, nw_interface_type_other),
  };
}

// One nw_path_monitor for each watch, on a queue of its own: it reports the current path at
// once, then each change, and a cancelled monitor reports nothing more.
class NetworkPathMonitor final : public PathMonitor {
 public:
  std::function<void()> watch(std::function<void(const NetworkPath &)> changed) override {
    nw_path_monitor_t monitor = nw_path_monitor_create();
    dispatch_queue_t queue = dispatch_queue_create("ng-native.network", DISPATCH_QUEUE_SERIAL);
    nw_path_monitor_set_queue(monitor, queue);
    auto listener = std::make_shared<std::function<void(const NetworkPath &)>>(std::move(changed));
    nw_path_monitor_set_update_handler(monitor, ^(nw_path_t path) {
      (*listener)(pathOf(path));
    });
    nw_path_monitor_start(monitor);
    return [monitor, queue] {
      nw_path_monitor_cancel(monitor);
      // Waits out an update already running, so none arrives after this returns.
      dispatch_sync(queue, ^{
                    });
    };
  }
};

} // namespace

std::shared_ptr<PathMonitor> makePathMonitor() {
  return std::make_shared<NetworkPathMonitor>();
}

} // namespace ngn::appkit
