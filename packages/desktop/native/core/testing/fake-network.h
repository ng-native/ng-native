// In-memory HTTP and WebSocket clients for the core tests: each request or connection is kept with
// its callbacks, and a test answers it by calling them.
#pragma once

#include "ngn/network.h"

#include <memory>
#include <string>
#include <vector>

namespace ngn::testing {

class FakeHttp final : public Http {
 public:
  struct Sent {
    HttpRequest request;
    HttpCallbacks callbacks;
    bool cancelled{false};
  };

  std::unique_ptr<HttpTask> send(HttpRequest request, HttpCallbacks callbacks) override;
  void clearCookies(std::function<void(bool)> done) override;

  std::vector<std::shared_ptr<Sent>> sent;
  int cookieClears{0};
};

class FakeWebSockets final : public WebSockets {
 public:
  struct Connection {
    std::string url;
    std::vector<std::string> protocols;
    Headers headers;
    WebSocketCallbacks callbacks;
    std::vector<std::string> log;
  };

  std::unique_ptr<WebSocketConnection> connect(
      const std::string &url,
      const std::vector<std::string> &protocols,
      const Headers &headers,
      WebSocketCallbacks callbacks) override;

  std::vector<std::shared_ptr<Connection>> connections;
};

} // namespace ngn::testing
