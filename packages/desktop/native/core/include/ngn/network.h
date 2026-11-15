// The network interface: HTTP and WebSocket clients, which a backend implements over the OS's own
// (NSURLSession on macOS). Everything above them, React Native's Networking and WebSocket modules
// and the dev server connection, is core code shared by every backend.
//
// Callbacks may arrive on any thread, but each request's or connection's arrive in order.
#pragma once

#include <react/http/IHttpClient.h>
#include <react/http/IWebSocketClient.h>

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace ngn {

using Headers = std::vector<std::pair<std::string, std::string>>;

struct HttpRequest {
  std::string method{"GET"};
  std::string url;
  Headers headers;
  // The body's bytes; empty for none.
  std::string body;
  // Zero for the client's default.
  uint32_t timeoutMs{0};
  // Whether the OS's cookie store applies to the request and takes its Set-Cookie headers.
  bool withCredentials{true};
};

struct HttpResponse {
  uint16_t status{0};
  Headers headers;
  // Where the response came from, after any redirects.
  std::string url;
};

struct HttpCallbacks {
  std::function<void(int64_t sent, int64_t total)> onUploadProgress;
  std::function<void(const HttpResponse &response)> onResponse;
  // Each chunk of the body as it arrives. `expected` is the length the response announced, or -1.
  std::function<void(std::string chunk, int64_t expected)> onData;
  // The last call for a request. An empty error is success.
  std::function<void(const std::string &error, bool timedOut)> onComplete;
};

class HttpTask {
 public:
  virtual ~HttpTask() = default;
  // No callback runs after cancel returns, onComplete included.
  virtual void cancel() = 0;
};

class Http {
 public:
  virtual ~Http() = default;
  virtual std::unique_ptr<HttpTask> send(HttpRequest request, HttpCallbacks callbacks) = 0;
  // Empties the cookie store requests share.
  virtual void clearCookies(std::function<void(bool cleared)> done) = 0;
};

struct WebSocketCallbacks {
  // `protocol` is the subprotocol the server chose, or empty.
  std::function<void(const std::string &protocol)> onOpen;
  std::function<void(const std::string &text)> onText;
  std::function<void(const std::string &bytes)> onBinary;
  // The connection closed after it opened.
  std::function<void(int code, const std::string &reason)> onClose;
  // The connection failed, before or after it opened. Nothing follows it.
  std::function<void(const std::string &message)> onError;
};

class WebSocketConnection {
 public:
  virtual ~WebSocketConnection() = default;
  virtual void sendText(const std::string &text) = 0;
  virtual void sendBinary(const std::string &bytes) = 0;
  virtual void ping() = 0;
  virtual void close(int code, const std::string &reason) = 0;
};

class WebSockets {
 public:
  virtual ~WebSockets() = default;
  virtual std::unique_ptr<WebSocketConnection> connect(
      const std::string &url,
      const std::vector<std::string> &protocols,
      const Headers &headers,
      WebSocketCallbacks callbacks) = 0;
};

// React Native's own client interfaces over these, for what ReactCxxPlatform drives itself: the
// bundle download, the packager connection and the inspector.
facebook::react::HttpClientFactory httpClientFactory(std::shared_ptr<Http> http);
facebook::react::WebSocketClientFactory webSocketClientFactory(std::shared_ptr<WebSockets> webSockets);

} // namespace ngn
