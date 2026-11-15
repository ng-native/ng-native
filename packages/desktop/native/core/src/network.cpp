#include "ngn/network.h"

#include <folly/io/IOBuf.h>

#include <mutex>

using namespace facebook::react;

namespace ngn {

namespace {

struct TaskToken final : http::IRequestToken {
  explicit TaskToken(std::unique_ptr<HttpTask> task) : task(std::move(task)) {}
  void cancel() noexcept override {
    if (task) {
      task->cancel();
    }
  }
  std::unique_ptr<HttpTask> task;
};

class HttpClientAdapter final : public IHttpClient {
 public:
  explicit HttpClientAdapter(std::shared_ptr<Http> http) : http_(std::move(http)) {}

  std::unique_ptr<http::IRequestToken> sendRequest(
      http::NetworkCallbacks &&callbacks,
      const std::string &method,
      const std::string &url,
      const http::Headers &headers,
      const http::Body &body,
      uint32_t timeout,
      std::optional<std::string>) override {
    HttpRequest request{.method = method, .url = url, .headers = headers, .timeoutMs = timeout};
    if (body.string) {
      request.body = *body.string;
    }
    // One body for the whole response unless the caller asked for it incrementally.
    struct Response {
      http::NetworkCallbacks callbacks;
      std::string body;
      int64_t received{0};
    };
    auto response = std::make_shared<Response>(Response{.callbacks = std::move(callbacks)});
    HttpCallbacks out{
        .onUploadProgress =
            [response](int64_t sent, int64_t total) {
              if (response->callbacks.onUploadProgress) {
                response->callbacks.onUploadProgress(sent, total);
              }
            },
        .onResponse =
            [response](const HttpResponse &r) {
              if (response->callbacks.onResponse) {
                response->callbacks.onResponse(r.status, r.headers);
              }
            },
        .onData =
            [response](std::string chunk, int64_t expected) {
              auto &cb = response->callbacks;
              response->received += static_cast<int64_t>(chunk.size());
              if (cb.sendIncrementalUpdates && cb.onBodyIncremental) {
                cb.onBodyIncremental(response->received, expected, folly::IOBuf::copyBuffer(chunk));
                return;
              }
              response->body += chunk;
              if (cb.sendProgressUpdates && cb.onBodyProgress) {
                cb.onBodyProgress(response->received, expected);
              }
            },
        .onComplete =
            [response](const std::string &error, bool timedOut) {
              auto &cb = response->callbacks;
              if (error.empty() && !timedOut && !cb.sendIncrementalUpdates && cb.onBody) {
                cb.onBody(folly::IOBuf::copyBuffer(response->body));
              }
              if (cb.onResponseComplete) {
                cb.onResponseComplete(error, timedOut);
              }
            },
    };
    return std::make_unique<TaskToken>(http_->send(std::move(request), std::move(out)));
  }

 private:
  std::shared_ptr<Http> http_;
};

class WebSocketClientAdapter final : public IWebSocketClient {
 public:
  explicit WebSocketClientAdapter(std::shared_ptr<WebSockets> webSockets)
      : webSockets_(std::move(webSockets)), callbacks_(std::make_shared<Callbacks>()) {}

  ~WebSocketClientAdapter() override {
    callbacks_->clear();
    if (connection_) {
      connection_->close(1000, "");
    }
  }

  void setOnClosedCallback(OnClosedCallback &&callback) noexcept override {
    std::lock_guard lock(callbacks_->mutex);
    callbacks_->closed = std::move(callback);
  }

  void setOnMessageCallback(OnMessageCallback &&callback) noexcept override {
    std::lock_guard lock(callbacks_->mutex);
    callbacks_->message = std::move(callback);
  }

  void connect(const std::string &url, OnConnectCallback &&callback) override {
    {
      std::lock_guard lock(callbacks_->mutex);
      callbacks_->connect = std::move(callback);
    }
    auto callbacks = callbacks_;
    connection_ = webSockets_->connect(
        url,
        {},
        {},
        WebSocketCallbacks{
            .onOpen = [callbacks](const std::string &) { callbacks->connected(true, ""); },
            .onText = [callbacks](const std::string &text) { callbacks->received(text); },
            .onBinary = [callbacks](const std::string &bytes) { callbacks->received(bytes); },
            .onClose = [callbacks](int, const std::string &reason) { callbacks->closedWith(reason); },
            .onError =
                [callbacks](const std::string &message) {
                  // A failure before the connection opened answers connect; after, it closes it.
                  if (!callbacks->connected(false, message)) {
                    callbacks->closedWith(message);
                  }
                },
        });
  }

  void close(const std::string &reason) override {
    if (connection_) {
      connection_->close(1000, reason);
    }
  }

  void send(const std::string &message) override {
    if (connection_) {
      connection_->sendText(message);
    }
  }

  void ping() override {
    if (connection_) {
      connection_->ping();
    }
  }

 private:
  struct Callbacks {
    std::mutex mutex;
    OnConnectCallback connect;
    OnClosedCallback closed;
    OnMessageCallback message;

    // Answers connect once. False when it was already answered.
    bool connected(bool success, const std::string &error) {
      OnConnectCallback callback;
      {
        std::lock_guard lock(mutex);
        callback = std::move(connect);
        connect = nullptr;
      }
      if (!callback) {
        return false;
      }
      callback(success, error);
      return true;
    }
    void received(const std::string &text) {
      OnMessageCallback callback;
      {
        std::lock_guard lock(mutex);
        callback = message;
      }
      if (callback) {
        callback(text);
      }
    }
    void closedWith(const std::string &reason) {
      OnClosedCallback callback;
      {
        std::lock_guard lock(mutex);
        callback = closed;
      }
      if (callback) {
        callback(reason);
      }
    }
    void clear() {
      std::lock_guard lock(mutex);
      connect = nullptr;
      closed = nullptr;
      message = nullptr;
    }
  };

  std::shared_ptr<WebSockets> webSockets_;
  std::shared_ptr<Callbacks> callbacks_;
  std::unique_ptr<WebSocketConnection> connection_;
};

} // namespace

HttpClientFactory httpClientFactory(std::shared_ptr<Http> http) {
  return [http] { return std::make_unique<HttpClientAdapter>(http); };
}

WebSocketClientFactory webSocketClientFactory(std::shared_ptr<WebSockets> webSockets) {
  return [webSockets] { return std::make_unique<WebSocketClientAdapter>(webSockets); };
}

} // namespace ngn
