// ImageLoader, in React Native iOS's shapes: Image.getSize, getSizeWithHeaders and prefetch. The
// bytes come over the backend's HTTP client (which also reads file and data URLs and shares the
// OS's URL cache with the views that draw images); the backend only measures them.
#include "ngn/core-modules.h"

namespace ngn {

namespace {

// Fetches `uri` and answers with the image's size, or an error.
void measure(
    const CoreModuleServices &s,
    const std::string &uri,
    Headers headers,
    std::function<void(std::optional<std::pair<double, double>>, std::string)> done) {
  struct Download {
    uint16_t status{0};
    std::string bytes;
  };
  auto download = std::make_shared<Download>();
  auto system = s.system;
  // The task is not kept: nothing cancels an image measurement, and the callbacks hold what they need.
  s.http->send(
      HttpRequest{.url = uri, .headers = std::move(headers)},
      HttpCallbacks{
          .onResponse = [download](const HttpResponse &r) { download->status = r.status; },
          .onData = [download](std::string chunk, int64_t) { download->bytes += chunk; },
          .onComplete =
              [download, system, uri, done](const std::string &error, bool) {
                if (!error.empty()) {
                  done(std::nullopt, error);
                } else if (download->status >= 400) {
                  done(std::nullopt, "HTTP " + std::to_string(download->status) + " for " + uri);
                } else if (auto size = system->imageSize(download->bytes)) {
                  done(size, "");
                } else {
                  done(std::nullopt, "Not an image: " + uri);
                }
              },
      });
}

std::string uriArg(const folly::dynamic &args) {
  return args.size() > 0 && args[0].isString() ? args[0].asString() : "";
}

} // namespace

std::shared_ptr<NativeModule> makeImageLoader(const CoreModuleServices &s) {
  struct ImageLoader : NativeModule {
    explicit ImageLoader(const CoreModuleServices &s) : NativeModule("ImageLoader") {
      constants([] { return folly::dynamic::object(); });
      promise("getSize", [s](const folly::dynamic &args, JsPromise p) {
        measure(s, uriArg(args), {}, [p](auto size, std::string error) {
          if (size) {
            p.resolve(folly::dynamic::array(size->first, size->second));
          } else {
            p.reject(error);
          }
        });
      });
      promise("getSizeWithHeaders", [s](const folly::dynamic &args, JsPromise p) {
        Headers headers;
        if (args.size() > 1 && args[1].isObject()) {
          for (const auto &[k, v] : args[1].items()) {
            headers.emplace_back(k.asString(), v.asString());
          }
        }
        measure(s, uriArg(args), std::move(headers), [p](auto size, std::string error) {
          if (size) {
            p.resolve(folly::dynamic::object("width", size->first)("height", size->second));
          } else {
            p.reject(error);
          }
        });
      });
      auto prefetch = [s](const folly::dynamic &args, JsPromise p) {
        measure(s, uriArg(args), {}, [p](auto size, std::string error) {
          if (size) {
            p.resolve(true);
          } else {
            p.reject(error);
          }
        });
      };
      promise("prefetchImage", prefetch);
      promise("prefetchImageWithMetadata", prefetch);
      // The OS's URL cache does not say what it holds, so nothing is reported as cached.
      promise("queryCache", [](const folly::dynamic &, JsPromise p) { p.resolve(folly::dynamic::object()); });
    }
  };
  return std::make_shared<ImageLoader>(s);
}

} // namespace ngn
