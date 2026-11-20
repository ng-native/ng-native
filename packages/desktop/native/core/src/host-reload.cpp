#include "ngn/host-reload.h"

#include <map>
#include <mutex>

namespace ngn {

namespace {

std::mutex &routesMutex() {
  static std::mutex mutex;
  return mutex;
}

std::map<const void *, std::function<void()>> &routes() {
  static std::map<const void *, std::function<void()>> routes;
  return routes;
}

} // namespace

void routeHostReload(const void *host, std::function<void()> reload) {
  std::lock_guard lock(routesMutex());
  if (reload) {
    routes()[host] = std::move(reload);
  } else {
    routes().erase(host);
  }
}

bool reloadThroughRoute(const void *host) {
  std::function<void()> reload;
  {
    std::lock_guard lock(routesMutex());
    auto it = routes().find(host);
    if (it == routes().end()) {
      return false;
    }
    reload = it->second;
  }
  reload();
  return true;
}

} // namespace ngn
