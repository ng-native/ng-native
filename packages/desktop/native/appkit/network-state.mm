#include "network-state.h"

#import <Network/Network.h>

#include <atomic>

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
    // Marks the queue with itself, so a stop called from a change on this watch's queue knows not
    // to wait for itself, while one from another watch's queue still waits.
    static char onQueue;
    dispatch_queue_set_specific(queue, &onQueue, (__bridge void *)queue, nullptr);
    nw_path_monitor_set_queue(monitor, queue);
    auto listener = std::make_shared<std::function<void(const NetworkPath &)>>(std::move(changed));
    nw_path_monitor_set_update_handler(monitor, ^(nw_path_t path) {
      (*listener)(pathOf(path));
    });
    // The cancel handler is the monitor's last call on the queue: no update follows it.
    dispatch_semaphore_t cancelled = dispatch_semaphore_create(0);
    nw_path_monitor_set_cancel_handler(monitor, ^{
      dispatch_semaphore_signal(cancelled);
    });
    nw_path_monitor_start(monitor);
    auto stopped = std::make_shared<std::atomic<bool>>(false);
    return [monitor, queue, cancelled, stopped] {
      if (stopped->exchange(true)) {
        return;
      }
      nw_path_monitor_cancel(monitor);
      // From a change on the queue, the change running is the last: waiting would deadlock.
      if (dispatch_get_specific(&onQueue) == (__bridge void *)queue) {
        return;
      }
      dispatch_semaphore_wait(cancelled, DISPATCH_TIME_FOREVER);
    };
  }
};

} // namespace

std::shared_ptr<PathMonitor> makePathMonitor() {
  return std::make_shared<NetworkPathMonitor>();
}

} // namespace ngn::appkit
