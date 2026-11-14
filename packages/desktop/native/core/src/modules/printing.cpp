#include "ngn/printing.h"

#include "ngn/bytes.h"
#include "ngn/crypto.h"
#include "ngn/download.h"
#include "ngn/file-system.h"

#include <algorithm>
#include <atomic>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <random>
#include <stdexcept>

namespace ngn {

namespace {

double number(const folly::dynamic &object, const char *key, double fallback) {
  const auto *value = object.isObject() ? object.get_ptr(key) : nullptr;
  return value != nullptr && value->isNumber() ? value->asDouble() : fallback;
}

std::string text(const folly::dynamic &object, const char *key) {
  const auto *value = object.isObject() ? object.get_ptr(key) : nullptr;
  return value != nullptr && value->isString() ? value->asString() : "";
}

bool landscape(const folly::dynamic &options) {
  return text(options, "orientation") == "landscape";
}

std::string newPdfName() {
  static std::mutex mutex;
  static std::random_device device;
  std::lock_guard lock(mutex);
  std::string bytes(16, '\0');
  for (auto &byte : bytes) {
    byte = static_cast<char>(device() & 0xff);
  }
  auto id = uuidV4(bytes);
  std::transform(id.begin(), id.end(), id.begin(), [](unsigned char c) { return std::toupper(c); });
  return id + ".pdf";
}

// The url the backend's HTTP client reads `uri` from, or nothing for one it cannot.
std::optional<std::string> readableUrl(const std::string &uri) {
  if (auto path = pathOfUri(uri)) {
    return fileUri(*path);
  }
  for (const char *scheme : {"http://", "https://", "data:"}) {
    if (uri.rfind(scheme, 0) == 0) {
      return uri;
    }
  }
  return std::nullopt;
}

std::string contents(const std::string &path) {
  std::ifstream in(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), {}};
}

} // namespace

PageSetup pageSetupOf(const folly::dynamic &options) {
  PageSetup page;
  page.width = number(options, "width", page.width);
  page.height = number(options, "height", page.height);
  if (landscape(options) && page.height > page.width) {
    std::swap(page.width, page.height);
  }
  if (const auto *margins = options.isObject() ? options.get_ptr("margins") : nullptr) {
    page.left = std::max(0.0, number(*margins, "left", 0));
    page.top = std::max(0.0, number(*margins, "top", 0));
    page.right = std::max(0.0, number(*margins, "right", 0));
    page.bottom = std::max(0.0, number(*margins, "bottom", 0));
  }
  if (page.width - page.left - page.right <= 0 || page.height - page.top - page.bottom <= 0) {
    throw std::invalid_argument("the page has no room to print on inside its margins");
  }
  return page;
}

std::shared_ptr<NativeModule> makePrintModule(std::shared_ptr<PrintSystem> system, std::shared_ptr<Http> http, std::string folder, bool noPrompts) {
  struct Print : NativeModule {
    Print(std::shared_ptr<PrintSystem> system, std::shared_ptr<Http> http, std::string folder, bool noPrompts)
        : NativeModule("NgNativePrint") {
      auto printing = std::make_shared<std::atomic<bool>>(false);
      promise("printAsync", [system, http, printing, noPrompts](const folly::dynamic &args, JsPromise promise) {
        const folly::dynamic options = args.empty() ? folly::dynamic(nullptr) : args[0];
        auto html = text(options, "html");
        auto uri = text(options, "uri");
        if (html.empty() && uri.empty()) {
          promise.reject("Print: No data to print. You must specify `uri` or `html` option");
          return;
        }
        std::optional<std::string> url;
        if (html.empty() && !(url = readableUrl(uri))) {
          promise.reject("Print: " + uri + " is not a file, data or http(s) uri");
          return;
        }
        if (noPrompts) {
          promise.resolve(nullptr);
          return;
        }
        if (printing->exchange(true)) {
          promise.reject("Print: the print panel is already showing");
          return;
        }
        auto turn = landscape(options);
        auto show = [system, printing, promise, turn](PrintSystem::Document document) {
          system->print(std::move(document), turn, [printing, promise](const std::string &error) {
            printing->store(false);
            if (error.empty()) {
              promise.resolve(nullptr);
            } else {
              promise.reject("Print: " + error);
            }
          });
        };
        if (!html.empty()) {
          show({.kind = PrintSystem::Document::Kind::Html, .content = std::move(html)});
          return;
        }
        auto label = uri.rfind("data:", 0) == 0 ? std::string("the data uri") : uri;
        fetchBytes(http, *url, [show, printing, promise, label](std::string body, const std::string &error) {
          if (!error.empty()) {
            printing->store(false);
            promise.reject("Print: could not read " + label + ": " + error);
            return;
          }
          auto kind = body.rfind("%PDF", 0) == 0 ? PrintSystem::Document::Kind::Pdf : PrintSystem::Document::Kind::Image;
          show({.kind = kind, .content = std::move(body)});
        });
      });

      promise("printToFileAsync", [system, folder](const folly::dynamic &args, JsPromise promise) {
        const folly::dynamic options = args.empty() ? folly::dynamic(nullptr) : args[0];
        PageSetup page;
        try {
          page = pageSetupOf(options);
        } catch (const std::invalid_argument &invalid) {
          promise.reject(std::string("Print: ") + invalid.what());
          return;
        }
        std::error_code ignored;
        std::filesystem::create_directories(folder, ignored);
        auto path = folder + "/" + newPdfName();
        const auto *base64 = options.isObject() ? options.get_ptr("base64") : nullptr;
        bool withBase64 = base64 != nullptr && base64->isBool() && base64->asBool();
        system->renderPdf(text(options, "html"), page, path, [promise, path, withBase64](int pages, const std::string &error) {
          if (!error.empty()) {
            promise.reject("Print: Error while rendering the PDF: " + error);
            return;
          }
          folly::dynamic result = folly::dynamic::object("uri", fileUri(path))("numberOfPages", pages);
          if (withBase64) {
            result["base64"] = base64Encode(contents(path));
          }
          promise.resolve(std::move(result));
        });
      });
    }
  };
  return std::make_shared<Print>(std::move(system), std::move(http), std::move(folder), noPrompts);
}

} // namespace ngn
