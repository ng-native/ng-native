// Networking: XMLHttpRequest and fetch, in React Native iOS's shapes, over the backend's HTTP
// client. Text responses can stream (incremental updates, which streaming fetch rides on), uploads
// report progress, and cookies and redirects are the OS client's.
#include "ngn/core-modules.h"

#include <atomic>
#include <fstream>
#include <map>
#include <mutex>
#include <sstream>

namespace ngn {

namespace {

std::optional<std::string> readFileUri(const std::string &uri) {
  std::string path = uri;
  if (path.rfind("file://", 0) == 0) {
    path = path.substr(7);
  } else if (path.empty() || path[0] != '/') {
    return std::nullopt;
  }
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    return std::nullopt;
  }
  std::stringstream out;
  out << in.rdbuf();
  return out.str();
}

std::string str(const folly::dynamic &v, const char *key) {
  return v.isObject() && v.count(key) && v[key].isString() ? v[key].asString() : "";
}

folly::dynamic headersObject(const Headers &headers) {
  folly::dynamic out = folly::dynamic::object();
  for (const auto &[name, value] : headers) {
    if (out.count(name)) {
      out[name] = out[name].asString() + ", " + value;
    } else {
      out[name] = value;
    }
  }
  return out;
}

std::string headerValue(const Headers &headers, const std::string &name) {
  for (const auto &[k, v] : headers) {
    if (k.size() == name.size() &&
        std::equal(k.begin(), k.end(), name.begin(), [](char a, char b) { return std::tolower(a) == std::tolower(b); })) {
      return v;
    }
  }
  return "";
}

} // namespace

RequestBody requestBody(const folly::dynamic &data, const BlobStore &blobs, const std::string &boundary) {
  RequestBody body;
  if (!data.isObject()) {
    return body;
  }
  if (data.count("string") && data["string"].isString()) {
    body.bytes = data["string"].asString();
  } else if (data.count("base64") && data["base64"].isString()) {
    auto bytes = base64Decode(data["base64"].asString());
    if (!bytes) {
      body.error = "The request body is not valid base64.";
    } else {
      body.bytes = *bytes;
    }
  } else if (data.count("blob")) {
    auto bytes = blobs.resolve(data["blob"]);
    if (!bytes) {
      body.error = "The request body's blob has been released.";
    } else {
      body.bytes = *bytes;
      body.contentType = str(data["blob"], "type");
    }
  } else if (data.count("uri") && data["uri"].isString()) {
    auto bytes = readFileUri(data["uri"].asString());
    if (!bytes) {
      body.error = "Could not read " + data["uri"].asString();
    } else {
      body.bytes = *bytes;
    }
  } else if (data.count("formData") && data["formData"].isArray()) {
    std::string out;
    for (const auto &part : data["formData"]) {
      out += "--" + boundary + "\r\n";
      std::string disposition = "form-data; name=\"" + str(part, "fieldName") + "\"";
      std::string partType = str(part, "type");
      std::string bytes;
      if (part.count("string") && part["string"].isString()) {
        bytes = part["string"].asString();
      } else if (part.count("uri") && part["uri"].isString()) {
        auto file = readFileUri(part["uri"].asString());
        if (!file) {
          body.error = "Could not read " + part["uri"].asString();
          return body;
        }
        bytes = *file;
        std::string name = str(part, "name");
        if (name.empty()) {
          auto uri = part["uri"].asString();
          name = uri.substr(uri.find_last_of('/') + 1);
        }
        disposition += "; filename=\"" + name + "\"";
        if (partType.empty()) {
          partType = "application/octet-stream";
        }
      }
      bool hasDisposition = false;
      std::string headerLines;
      if (part.count("headers") && part["headers"].isObject()) {
        for (const auto &[k, v] : part["headers"].items()) {
          std::string key = k.asString();
          std::string lower = key;
          for (auto &c : lower) {
            c = std::tolower(c);
          }
          if (lower == "content-disposition") {
            hasDisposition = true;
          }
          if (lower == "content-type") {
            partType.clear();
          }
          headerLines += key + ": " + (v.isString() ? v.asString() : "") + "\r\n";
        }
      }
      if (!hasDisposition) {
        out += "Content-Disposition: " + disposition + "\r\n";
      }
      out += headerLines;
      if (!partType.empty()) {
        out += "Content-Type: " + partType + "\r\n";
      }
      out += "\r\n" + bytes + "\r\n";
    }
    out += "--" + boundary + "--\r\n";
    body.bytes = std::move(out);
    body.contentType = "multipart/form-data; boundary=" + boundary;
  }
  return body;
}

std::shared_ptr<NativeModule> makeNetworking(const CoreModuleServices &s) {
  struct Networking : NativeModule, std::enable_shared_from_this<Networking> {
    explicit Networking(const CoreModuleServices &s) : NativeModule("Networking"), http(s.http), blobs(s.blobs) {
      async("sendRequest", [this](const folly::dynamic &args, std::vector<JsCallback> callbacks) {
        int id = ++nextId;
        if (!callbacks.empty() && callbacks[0]) {
          callbacks[0](folly::dynamic::array(id));
        }
        send(id, args.size() > 0 && args[0].isObject() ? args[0] : folly::dynamic::object());
      });
      async("abortRequest", [this](const folly::dynamic &args, std::vector<JsCallback>) {
        if (args.size() > 0 && args[0].isNumber()) {
          abort(static_cast<int>(args[0].asDouble()));
        }
      });
      async("clearCookies", [this](const folly::dynamic &, std::vector<JsCallback> callbacks) {
        JsCallback done = callbacks.empty() ? nullptr : callbacks[0];
        http->clearCookies([done](bool cleared) {
          if (done) {
            done(folly::dynamic::array(cleared));
          }
        });
      });
      listeners();
    }

    ~Networking() override {
      std::map<int, std::shared_ptr<HttpTask>> open;
      {
        std::lock_guard lock(mutex);
        open.swap(tasks);
      }
      for (auto &[_, task] : open) {
        if (task) {
          task->cancel();
        }
      }
    }

    void send(int id, const folly::dynamic &query) {
      std::string boundary = "ngn-boundary-" + std::to_string(id) + "-" + std::to_string(reinterpret_cast<uintptr_t>(this));
      auto body = requestBody(query.getDefault("data", folly::dynamic::object()), *blobs, boundary);
      if (!body.error.empty()) {
        emit("didCompleteNetworkResponse", folly::dynamic::array(id, body.error, false));
        return;
      }
      HttpRequest request{.method = str(query, "method"), .url = str(query, "url"), .body = std::move(body.bytes)};
      if (request.method.empty()) {
        request.method = "GET";
      }
      auto headers = query.getDefault("headers", folly::dynamic::object());
      if (headers.isObject()) {
        for (const auto &[k, v] : headers.items()) {
          request.headers.emplace_back(k.asString(), v.asString());
        }
      }
      if (!body.contentType.empty() && headerValue(request.headers, "content-type").empty()) {
        request.headers.emplace_back("Content-Type", body.contentType);
      }
      auto timeout = query.getDefault("timeout", 0);
      request.timeoutMs = timeout.isNumber() ? static_cast<uint32_t>(timeout.asDouble()) : 0;
      auto credentials = query.getDefault("withCredentials", true);
      request.withCredentials = !credentials.isBool() || credentials.asBool();
      std::string responseType = str(query, "responseType");
      if (responseType.empty()) {
        responseType = "text";
      }
      auto incremental = query.getDefault("incrementalUpdates", false);
      bool incrementalUpdates = incremental.isBool() && incremental.asBool();

      struct Response {
        std::string body;
        std::string contentType;
        int64_t received{0};
        Utf8Chunker text;
      };
      auto response = std::make_shared<Response>();
      std::weak_ptr<Networking> weak = shared_from_this();
      HttpCallbacks callbacks{
          .onUploadProgress =
              [weak, id](int64_t sent, int64_t total) {
                if (auto self = weak.lock()) {
                  self->emit("didSendNetworkData", folly::dynamic::array(id, sent, total));
                }
              },
          .onResponse =
              [weak, id, response](const HttpResponse &r) {
                response->contentType = headerValue(r.headers, "content-type");
                if (auto self = weak.lock()) {
                  self->emit(
                      "didReceiveNetworkResponse", folly::dynamic::array(id, r.status, headersObject(r.headers), r.url));
                }
              },
          .onData =
              [weak, id, response, responseType, incrementalUpdates](std::string chunk, int64_t expected) {
                auto self = weak.lock();
                if (!self) {
                  return;
                }
                response->received += static_cast<int64_t>(chunk.size());
                if (responseType == "text" && incrementalUpdates) {
                  self->emit(
                      "didReceiveNetworkIncrementalData",
                      folly::dynamic::array(id, response->text.push(std::move(chunk)), response->received, expected));
                  return;
                }
                response->body += chunk;
                if (incrementalUpdates) {
                  self->emit("didReceiveNetworkDataProgress", folly::dynamic::array(id, response->received, expected));
                }
              },
          .onComplete =
              [weak, id, response, responseType, incrementalUpdates](const std::string &error, bool timedOut) {
                auto self = weak.lock();
                if (!self) {
                  return;
                }
                {
                  std::lock_guard lock(self->mutex);
                  self->tasks.erase(id);
                }
                if (error.empty() && !timedOut) {
                  if (responseType == "text" && incrementalUpdates) {
                    auto rest = response->text.finish();
                    if (!rest.empty()) {
                      self->emit(
                          "didReceiveNetworkIncrementalData",
                          folly::dynamic::array(id, rest, response->received, response->received));
                    }
                  } else if (responseType == "base64") {
                    self->emit("didReceiveNetworkData", folly::dynamic::array(id, base64Encode(response->body)));
                  } else if (responseType == "blob") {
                    auto size = static_cast<int64_t>(response->body.size());
                    auto blobId = self->blobs->store(std::move(response->body));
                    self->emit(
                        "didReceiveNetworkData",
                        folly::dynamic::array(
                            id,
                            folly::dynamic::object("blobId", blobId)("offset", 0)("size", size)(
                                "type", response->contentType)));
                  } else {
                    self->emit("didReceiveNetworkData", folly::dynamic::array(id, response->body));
                  }
                }
                self->emit(
                    "didCompleteNetworkResponse",
                    folly::dynamic::array(
                        id, error.empty() && !timedOut ? folly::dynamic(nullptr) : folly::dynamic(error), timedOut));
              },
      };
      {
        std::lock_guard lock(mutex);
        tasks[id] = nullptr;
      }
      std::shared_ptr<HttpTask> task = http->send(std::move(request), std::move(callbacks));
      std::lock_guard lock(mutex);
      // A request that completed during send is already gone from tasks.
      if (auto it = tasks.find(id); it != tasks.end()) {
        it->second = task;
      }
    }

    void abort(int id) {
      std::shared_ptr<HttpTask> task;
      {
        std::lock_guard lock(mutex);
        auto it = tasks.find(id);
        if (it == tasks.end()) {
          return;
        }
        task = it->second;
        tasks.erase(it);
      }
      if (task) {
        task->cancel();
      }
    }

    std::shared_ptr<Http> http;
    std::shared_ptr<BlobStore> blobs;
    std::atomic<int> nextId{0};
    std::mutex mutex;
    std::map<int, std::shared_ptr<HttpTask>> tasks;
  };
  return std::make_shared<Networking>(s);
}

} // namespace ngn
