// The HTTP and WebSocket clients ReactCxxPlatform declares and leaves to a host. Until the core
// has its own (Networking, the dev server, Fast Refresh), both refuse, and the bundle loads from
// disk.
#include <react/http/IHttpClient.h>
#include <react/http/IWebSocketClient.h>

namespace facebook::react {

namespace {

struct RefusingHttpClient final : IHttpClient {
  std::unique_ptr<http::IRequestToken> sendRequest(
      http::NetworkCallbacks &&callbacks,
      const std::string &,
      const std::string &,
      const http::Headers &,
      const http::Body &,
      uint32_t,
      std::optional<std::string>) override {
    if (callbacks.onResponseComplete) {
      callbacks.onResponseComplete("the desktop host has no HTTP client yet", false);
    }
    return nullptr;
  }
};

struct RefusingWebSocketClient final : IWebSocketClient {
  void setOnClosedCallback(OnClosedCallback &&) noexcept override {}
  void setOnMessageCallback(OnMessageCallback &&) noexcept override {}
  void connect(const std::string &, OnConnectCallback &&callback) override {
    if (callback) {
      callback(false, "the desktop host has no WebSocket client yet");
    }
  }
  void close(const std::string &) override {}
  void send(const std::string &) override {}
  void ping() override {}
};

} // namespace

HttpClientFactory getHttpClientFactory() {
  return [] { return std::make_unique<RefusingHttpClient>(); };
}

WebSocketClientFactory getWebSocketClientFactory() {
  return [] { return std::make_unique<RefusingWebSocketClient>(); };
}

} // namespace facebook::react
