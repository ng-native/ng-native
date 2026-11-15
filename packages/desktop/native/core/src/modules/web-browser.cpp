#include "ngn/web-browser.h"

#include "ngn/processes.h"

#include <algorithm>
#include <atomic>
#include <cctype>

namespace ngn {

namespace {

std::string lower(std::string text) {
  std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return std::tolower(c); });
  return text;
}

folly::dynamic result(const char *type) {
  return folly::dynamic::object("type", type);
}

} // namespace

bool webUrl(const std::string &url) {
  auto colon = url.find(':');
  if (colon == std::string::npos || !externalUrlAllowed(url)) {
    return false;
  }
  auto scheme = lower(url.substr(0, colon));
  return (scheme == "http" || scheme == "https") && url.compare(colon, 3, "://") == 0 && url.size() > colon + 3;
}

std::shared_ptr<NativeModule> makeWebBrowserModule(std::shared_ptr<System> system, std::shared_ptr<AuthSession> sessions, bool noPrompts) {
  struct WebBrowser : NativeModule {
    std::shared_ptr<std::atomic<bool>> inSession = std::make_shared<std::atomic<bool>>(false);

    WebBrowser(std::shared_ptr<System> system, std::shared_ptr<AuthSession> sessions, bool noPrompts)
        : NativeModule("NgNativeWebBrowser") {
      promise("openBrowserAsync", [system](const folly::dynamic &args, JsPromise promise) {
        std::string url = !args.empty() && args[0].isString() ? args[0].asString() : "";
        if (!webUrl(url)) {
          promise.reject("WebBrowser.openBrowserAsync: the url must use http or https: " + url);
          return;
        }
        system->openUrl(url, [promise, url](bool opened) {
          if (opened) {
            promise.resolve(result("opened"));
          } else {
            promise.reject("WebBrowser.openBrowserAsync: no browser opened " + url);
          }
        });
      });
      promise("dismissBrowser", [](const folly::dynamic &, JsPromise promise) { promise.resolve(result("dismiss")); });
      auto busy = inSession;
      promise("openAuthSessionAsync", [sessions, noPrompts, busy](const folly::dynamic &args, JsPromise promise) {
        std::string url = !args.empty() && args[0].isString() ? args[0].asString() : "";
        if (!webUrl(url)) {
          promise.reject("WebBrowser.openAuthSessionAsync: the url must use http or https: " + url);
          return;
        }
        std::string redirect = args.size() > 1 && args[1].isString() ? args[1].asString() : "";
        auto colon = redirect.find(':');
        bool ephemeral = false;
        if (args.size() > 2 && args[2].isObject()) {
          const auto *flag = args[2].get_ptr("preferEphemeralSession");
          ephemeral = flag != nullptr && flag->isBool() && flag->asBool();
        }
        if (noPrompts || !sessions) {
          promise.resolve(result("cancel"));
          return;
        }
        if (busy->exchange(true)) {
          promise.reject("WebBrowser.openAuthSessionAsync: another authentication session is already open");
          return;
        }
        sessions->start(
            {.url = url, .callbackScheme = colon == std::string::npos ? "" : lower(redirect.substr(0, colon)), .ephemeral = ephemeral},
            [promise, busy](std::optional<std::string> ended, std::string error) {
              busy->store(false);
              if (!error.empty()) {
                promise.reject("WebBrowser.openAuthSessionAsync: " + error);
              } else if (ended) {
                promise.resolve(folly::dynamic::object("type", "success")("url", *ended));
              } else {
                promise.resolve(result("cancel"));
              }
            });
      });
      promise("dismissAuthSession", [sessions](const folly::dynamic &, JsPromise promise) {
        if (sessions) {
          sessions->cancel();
        }
        promise.resolve(nullptr);
      });
    }
  };
  return std::make_shared<WebBrowser>(std::move(system), std::move(sessions), noPrompts);
}

} // namespace ngn
