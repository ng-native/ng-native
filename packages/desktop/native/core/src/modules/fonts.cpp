#include "ngn/fonts.h"

#include "ngn/download.h"
#include "ngn/file-system.h"

#include <functional>
#include <sstream>
#include <stdexcept>

namespace ngn {

void FontLibrary::add(const std::string &name, RegisteredFont font) {
  std::lock_guard lock(mutex_);
  if (fonts_.find(name) == fonts_.end()) {
    order_.push_back(name);
  }
  fonts_[name] = std::move(font);
}

bool FontLibrary::has(const std::string &name) const {
  std::lock_guard lock(mutex_);
  return fonts_.find(name) != fonts_.end();
}

std::optional<RegisteredFont> FontLibrary::fontOf(const std::string &name) const {
  std::lock_guard lock(mutex_);
  auto it = fonts_.find(name);
  return it == fonts_.end() ? std::nullopt : std::optional(it->second);
}

std::vector<std::string> FontLibrary::names() const {
  std::lock_guard lock(mutex_);
  return order_;
}

namespace {

bool isHttp(const std::string &uri) {
  return uri.rfind("http://", 0) == 0 || uri.rfind("https://", 0) == 0;
}

// Where a downloaded font is kept: one file per uri, keeping its extension, which CTFontManager
// reads the format from.
std::string downloadPath(const std::string &folder, const std::string &uri) {
  auto path = uri.substr(0, uri.find_first_of("?#"));
  auto slash = path.rfind('/');
  auto dot = path.rfind('.');
  std::string extension = dot != std::string::npos && (slash == std::string::npos || dot > slash) ? path.substr(dot) : "";
  if (extension.size() > 6) {
    extension.clear();
  }
  std::ostringstream name;
  name << std::hex << std::hash<std::string>{}(uri) << extension;
  return folder + "/" + name.str();
}

} // namespace

std::shared_ptr<NativeModule> makeFontModule(
    std::shared_ptr<FontRegistrar> registrar,
    std::shared_ptr<FontLibrary> library,
    std::shared_ptr<Http> http,
    std::string downloads) {
  struct Fonts : NativeModule {
    Fonts(std::shared_ptr<FontRegistrar> registrar, std::shared_ptr<FontLibrary> library, std::shared_ptr<Http> http, std::string downloads)
        : NativeModule("NgNativeFont") {
      auto load = [registrar, library](const std::string &name, const std::string &path, JsPromise promise) {
        try {
          library->add(name, registrar->registerFile(path));
          promise.resolve(nullptr);
        } catch (const std::exception &error) {
          promise.reject("Fonts: " + name + " could not be loaded from " + path + ": " + error.what());
        }
      };
      promise("loadAsync", [load, http, downloads](const folly::dynamic &args, JsPromise promise) {
        if (args.size() < 2 || !args[0].isString() || args[0].asString().empty() || !args[1].isString()) {
          promise.reject("Fonts.loadAsync: takes a font's name and the uri of its file");
          return;
        }
        auto name = args[0].asString();
        auto uri = args[1].asString();
        if (auto path = pathOfUri(uri)) {
          load(name, *path, std::move(promise));
          return;
        }
        if (!isHttp(uri) || !http) {
          promise.reject("Fonts.loadAsync: " + name + "'s uri is not a file or an http(s) url: " + uri);
          return;
        }
        auto target = downloadPath(downloads, uri);
        downloadFile(http, uri, target, [load, name, uri, target, promise](const std::string &error) mutable {
          if (!error.empty()) {
            promise.reject("Fonts: " + name + " could not be downloaded from " + uri + ": " + error);
            return;
          }
          load(name, target, std::move(promise));
        });
      });
      sync("isLoaded", [library](const folly::dynamic &args) {
        return folly::dynamic(!args.empty() && args[0].isString() && library->has(args[0].asString()));
      });
      sync("getLoadedFonts", [library](const folly::dynamic &) {
        folly::dynamic names = folly::dynamic::array();
        for (const auto &name : library->names()) {
          names.push_back(name);
        }
        return names;
      });
    }
  };
  return std::make_shared<Fonts>(std::move(registrar), std::move(library), std::move(http), std::move(downloads));
}

} // namespace ngn
