// The core's HTTP and WebSocket interfaces over NSURLSession: the system's cookie store, redirects,
// proxies and TLS, as React Native iOS gets them.
#pragma once

#include "ngn/network.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<Http> makeHttp();
std::shared_ptr<WebSockets> makeWebSockets();

} // namespace ngn::appkit
