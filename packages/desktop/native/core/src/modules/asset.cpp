#include "ngn/asset.h"

#include "ngn/download.h"
#include "ngn/file-system.h"

#include <filesystem>
#include <functional>
#include <sstream>

namespace ngn {

namespace {

bool isHttp(const std::string &uri) {
  return uri.rfind("http://", 0) == 0 || uri.rfind("https://", 0) == 0;
}

// The extension the url's path ends in, without its dot, or nothing.
std::string extensionOf(const std::string &uri) {
  auto path = uri.substr(0, uri.find_first_of("?#"));
  auto slash = path.rfind('/');
  auto dot = path.rfind('.');
  if (dot == std::string::npos || (slash != std::string::npos && dot < slash) || path.size() - dot > 6) {
    return "";
  }
  return path.substr(dot + 1);
}

std::string text(const folly::dynamic &args, size_t index) {
  return args.size() > index && args[index].isString() ? args[index].asString() : "";
}

} // namespace

std::shared_ptr<NativeModule> makeAssetModule(std::shared_ptr<Http> http, std::string caches) {
  struct Asset : NativeModule {
    Asset(std::shared_ptr<Http> http, std::string caches) : NativeModule("NgNativeAsset") {
      promise("downloadAsync", [http, caches](const folly::dynamic &args, JsPromise promise) {
        auto uri = text(args, 0);
        if (uri.empty()) {
          promise.reject("Asset.downloadAsync: takes the asset's uri");
          return;
        }
        if (auto path = pathOfUri(uri)) {
          std::error_code ignored;
          if (std::filesystem::is_regular_file(*path, ignored)) {
            promise.resolve(fileUri(*path));
          } else {
            promise.reject("Asset: there is no file at " + *path);
          }
          return;
        }
        if (!isHttp(uri) || !http) {
          promise.reject("Asset: " + uri + " is not a file or an http(s) url");
          return;
        }
        auto hash = text(args, 1);
        auto type = text(args, 2);
        if (type.empty()) {
          type = extensionOf(uri);
        }
        std::ostringstream name;
        name << "ExponentAsset-";
        if (hash.empty()) {
          name << std::hex << std::hash<std::string>{}(uri);
        } else {
          name << hash;
        }
        if (!type.empty()) {
          name << "." << type;
        }
        auto target = caches + "/" + name.str();
        std::error_code ignored;
        if (!hash.empty() && std::filesystem::is_regular_file(target, ignored)) {
          promise.resolve(fileUri(target));
          return;
        }
        downloadFile(http, uri, target, [uri, target, promise](const std::string &error) {
          if (error.empty()) {
            promise.resolve(fileUri(target));
          } else {
            promise.reject("Asset: " + uri + " could not be downloaded: " + error);
          }
        });
      });
    }
  };
  return std::make_shared<Asset>(std::move(http), std::move(caches));
}

} // namespace ngn
