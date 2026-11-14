// WebSocketModule and BlobModule: WebSocket in React Native iOS's shapes, over the backend's
// client, with binary messages as base64 or, once JavaScript asks, as blobs; and the blob store
// behind Blob, which Networking, WebSocket and FileReader share.
#include "ngn/core-modules.h"

#include <map>
#include <mutex>

namespace ngn {

namespace {

using BlobSockets = BlobStore::Sockets;

std::shared_ptr<BlobSockets> blobSockets(const std::shared_ptr<BlobStore> &blobs) {
  return std::shared_ptr<BlobSockets>(blobs, &blobs->sockets);
}

int intArg(const folly::dynamic &args, size_t i) {
  return args.size() > i && args[i].isNumber() ? static_cast<int>(args[i].asDouble()) : -1;
}

std::string stringArg(const folly::dynamic &args, size_t i) {
  return args.size() > i && args[i].isString() ? args[i].asString() : "";
}

} // namespace

std::shared_ptr<NativeModule> makeWebSocket(const CoreModuleServices &s) {
  struct WebSocketModule : NativeModule, std::enable_shared_from_this<WebSocketModule> {
    explicit WebSocketModule(const CoreModuleServices &s)
        : NativeModule("WebSocketModule"), webSockets(s.webSockets), blobs(s.blobs), blobIds(blobSockets(s.blobs)) {
      async("connect", [this](const folly::dynamic &args, std::vector<JsCallback>) {
        std::vector<std::string> protocols;
        if (args.size() > 1 && args[1].isArray()) {
          for (const auto &p : args[1]) {
            if (p.isString()) {
              protocols.push_back(p.asString());
            }
          }
        }
        Headers headers;
        if (args.size() > 2 && args[2].isObject() && args[2].count("headers") && args[2]["headers"].isObject()) {
          for (const auto &[k, v] : args[2]["headers"].items()) {
            headers.emplace_back(k.asString(), v.asString());
          }
        }
        connect(stringArg(args, 0), protocols, headers, intArg(args, 3));
      });
      async("send", [this](const folly::dynamic &args, std::vector<JsCallback>) {
        if (auto c = connection(intArg(args, 1))) {
          c->sendText(stringArg(args, 0));
        }
      });
      async("sendBinary", [this](const folly::dynamic &args, std::vector<JsCallback>) {
        auto bytes = base64Decode(stringArg(args, 0));
        if (auto c = connection(intArg(args, 1)); c && bytes) {
          c->sendBinary(*bytes);
        }
      });
      async("ping", [this](const folly::dynamic &args, std::vector<JsCallback>) {
        if (auto c = connection(intArg(args, 0))) {
          c->ping();
        }
      });
      async("close", [this](const folly::dynamic &args, std::vector<JsCallback>) {
        int id = intArg(args, 2);
        if (auto c = connection(id)) {
          c->close(intArg(args, 0) < 0 ? 1000 : intArg(args, 0), stringArg(args, 1));
        }
      });
      listeners();
    }

    ~WebSocketModule() override {
      std::map<int, std::shared_ptr<WebSocketConnection>> open;
      {
        std::lock_guard lock(mutex);
        open.swap(connections);
      }
      for (auto &[id, c] : open) {
        c->close(1001, "");
        std::lock_guard lock(blobIds->mutex);
        blobIds->senders.erase(id);
      }
    }

    std::shared_ptr<WebSocketConnection> connection(int id) {
      std::lock_guard lock(mutex);
      auto it = connections.find(id);
      return it == connections.end() ? nullptr : it->second;
    }

    void forget(int id) {
      {
        std::lock_guard lock(mutex);
        connections.erase(id);
      }
      std::lock_guard lock(blobIds->mutex);
      blobIds->senders.erase(id);
    }

    void connect(const std::string &url, const std::vector<std::string> &protocols, const Headers &headers, int id) {
      std::weak_ptr<WebSocketModule> weak = shared_from_this();
      WebSocketCallbacks callbacks{
          .onOpen =
              [weak, id](const std::string &protocol) {
                if (auto self = weak.lock()) {
                  self->emit("websocketOpen", folly::dynamic::object("id", id)("protocol", protocol));
                }
              },
          .onText =
              [weak, id](const std::string &text) {
                if (auto self = weak.lock()) {
                  self->emit("websocketMessage", folly::dynamic::object("id", id)("type", "text")("data", text));
                }
              },
          .onBinary =
              [weak, id](const std::string &bytes) {
                auto self = weak.lock();
                if (!self) {
                  return;
                }
                bool asBlob;
                {
                  std::lock_guard lock(self->blobIds->mutex);
                  asBlob = self->blobIds->ids.count(id) > 0;
                }
                if (asBlob) {
                  auto size = static_cast<int64_t>(bytes.size());
                  auto blobId = self->blobs->store(bytes);
                  self->emit(
                      "websocketMessage",
                      folly::dynamic::object("id", id)("type", "blob")(
                          "data", folly::dynamic::object("blobId", blobId)("offset", 0)("size", size)));
                } else {
                  self->emit(
                      "websocketMessage", folly::dynamic::object("id", id)("type", "binary")("data", base64Encode(bytes)));
                }
              },
          .onClose =
              [weak, id](int code, const std::string &reason) {
                if (auto self = weak.lock()) {
                  self->forget(id);
                  self->emit("websocketClosed", folly::dynamic::object("id", id)("code", code)("reason", reason));
                }
              },
          .onError =
              [weak, id](const std::string &message) {
                if (auto self = weak.lock()) {
                  self->forget(id);
                  self->emit("websocketFailed", folly::dynamic::object("id", id)("message", message));
                }
              },
      };
      std::shared_ptr<WebSocketConnection> c = webSockets->connect(url, protocols, headers, std::move(callbacks));
      if (!c) {
        return;
      }
      {
        std::lock_guard lock(mutex);
        connections[id] = c;
      }
      std::weak_ptr<WebSocketConnection> weakConnection = c;
      std::lock_guard lock(blobIds->mutex);
      blobIds->senders[id] = [weakConnection](const std::string &bytes) {
        if (auto c = weakConnection.lock()) {
          c->sendBinary(bytes);
        }
      };
    }

    std::shared_ptr<WebSockets> webSockets;
    std::shared_ptr<BlobStore> blobs;
    std::shared_ptr<BlobSockets> blobIds;
    std::mutex mutex;
    std::map<int, std::shared_ptr<WebSocketConnection>> connections;
  };
  return std::make_shared<WebSocketModule>(s);
}

std::shared_ptr<NativeModule> makeBlobModule(const CoreModuleServices &s) {
  struct BlobModule : NativeModule {
    explicit BlobModule(const CoreModuleServices &s) : NativeModule("BlobModule"), blobs(s.blobs), sockets(blobSockets(s.blobs)) {
      constants([] { return folly::dynamic::object("BLOB_URI_SCHEME", "blob")("BLOB_URI_HOST", nullptr); });
      // Networking already answers responseType 'blob' and sends blob bodies.
      async("addNetworkingHandler", [](const folly::dynamic &, std::vector<JsCallback>) {});
      async("addWebSocketHandler", [this](const folly::dynamic &args, std::vector<JsCallback>) {
        std::lock_guard lock(sockets->mutex);
        sockets->ids.insert(intArg(args, 0));
      });
      async("removeWebSocketHandler", [this](const folly::dynamic &args, std::vector<JsCallback>) {
        std::lock_guard lock(sockets->mutex);
        sockets->ids.erase(intArg(args, 0));
      });
      async("sendOverSocket", [this](const folly::dynamic &args, std::vector<JsCallback>) {
        auto bytes = args.size() > 0 ? blobs->resolve(args[0]) : std::nullopt;
        std::function<void(const std::string &)> send;
        {
          std::lock_guard lock(sockets->mutex);
          auto it = sockets->senders.find(intArg(args, 1));
          if (it != sockets->senders.end()) {
            send = it->second;
          }
        }
        if (bytes && send) {
          send(*bytes);
        }
      });
      async("createFromParts", [this](const folly::dynamic &args, std::vector<JsCallback>) {
        std::string bytes;
        if (args.size() > 0 && args[0].isArray()) {
          for (const auto &part : args[0]) {
            if (!part.isObject()) {
              continue;
            }
            auto type = part.getDefault("type", "");
            if (type == "string" && part.count("data") && part["data"].isString()) {
              bytes += part["data"].asString();
            } else if (type == "blob" && part.count("data")) {
              bytes += blobs->resolve(part["data"]).value_or("");
            }
          }
        }
        blobs->put(stringArg(args, 1), std::move(bytes));
      });
      async("release", [this](const folly::dynamic &args, std::vector<JsCallback>) { blobs->release(stringArg(args, 0)); });
    }

    std::shared_ptr<BlobStore> blobs;
    std::shared_ptr<BlobSockets> sockets;
  };
  return std::make_shared<BlobModule>(s);
}

std::shared_ptr<NativeModule> makeFileReader(const CoreModuleServices &s) {
  struct FileReader : NativeModule {
    explicit FileReader(const CoreModuleServices &s) : NativeModule("FileReaderModule") {
      auto blobs = s.blobs;
      promise("readAsDataURL", [blobs](const folly::dynamic &args, JsPromise p) {
        auto blob = args.size() > 0 ? args[0] : folly::dynamic(nullptr);
        auto bytes = blobs->resolve(blob);
        if (!bytes) {
          p.reject("The blob has been released.");
          return;
        }
        std::string type = blob.isObject() && blob.count("type") && blob["type"].isString() && !blob["type"].asString().empty()
            ? blob["type"].asString()
            : "application/octet-stream";
        p.resolve("data:" + type + ";base64," + base64Encode(*bytes));
      });
      promise("readAsText", [blobs](const folly::dynamic &args, JsPromise p) {
        auto bytes = args.size() > 0 ? blobs->resolve(args[0]) : std::nullopt;
        if (!bytes) {
          p.reject("The blob has been released.");
          return;
        }
        // UTF-8 only, as on iOS in practice; other encodings come back as their bytes.
        p.resolve(*bytes);
      });
    }
  };
  return std::make_shared<FileReader>(s);
}

} // namespace ngn
