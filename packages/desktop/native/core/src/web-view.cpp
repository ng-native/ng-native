#include "ngn/web-view.h"

#include <folly/json.h>

#include <regex>

namespace ngn {

std::string webViewOrigin(const std::string &url) {
  static const std::regex origin(R"(^[A-Za-z][A-Za-z0-9+\-.]+:(//)?[^/]*)");
  std::smatch match;
  return std::regex_search(url, match, origin) ? match.str(0) : "";
}

bool passesOriginWhitelist(const std::vector<std::string> &whitelist, const std::string &url) {
  if (url.rfind("about:", 0) == 0 || url.rfind("data:", 0) == 0) {
    return true;
  }
  auto origin = webViewOrigin(url);
  for (const auto &pattern : whitelist) {
    std::string expression = "^";
    for (char c : pattern) {
      if (c == '*') {
        expression += ".*";
      } else if (std::string_view("\\^$.|?+()[]{}-").find(c) != std::string_view::npos) {
        expression += '\\';
        expression += c;
      } else {
        expression += c;
      }
    }
    if (std::regex_search(origin, std::regex(expression))) {
      return true;
    }
  }
  return false;
}

NavigationStep navigationStep(const WebViewConfig &config, const std::string &url, bool topFrame) {
  if (topFrame && config.originWhitelist && !passesOriginWhitelist(*config.originWhitelist, url)) {
    return NavigationStep::OpenExternally;
  }
  return NavigationStep::AskApp;
}

std::string webViewMessagingScript() {
  return "window.ReactNativeWebView = window.ReactNativeWebView || {};"
         "window.ReactNativeWebView.postMessage = function (data) {"
         "  window.webkit.messageHandlers.ReactNativeWebView.postMessage(String(data));"
         "};";
}

std::string webViewInjectedObjectScript(const std::string &json) {
  return "window.ReactNativeWebView = window.ReactNativeWebView || {};"
         "window.ReactNativeWebView.injectedObjectJson = function () { return " +
      folly::toJson(json) + "; };";
}

std::string webViewPostMessageScript(const std::string &data) {
  return "window.dispatchEvent(new MessageEvent('message', " + folly::toJson(folly::dynamic::object("data", data)) + "));";
}

folly::dynamic webViewEvent(const WebViewState &state) {
  return folly::dynamic::object("url", state.url)("title", state.title)("loading", state.loading)("canGoBack", state.canGoBack)(
      "canGoForward", state.canGoForward);
}

int NavigationLocks::hold(std::function<void(bool)> decide) {
  std::lock_guard lock(mutex_);
  int id = next_++;
  held_[id] = std::move(decide);
  return id;
}

bool NavigationLocks::settle(int lock, bool shouldStart) {
  std::function<void(bool)> decide;
  {
    std::lock_guard guard(mutex_);
    auto found = held_.find(lock);
    if (found == held_.end()) {
      return false;
    }
    decide = std::move(found->second);
    held_.erase(found);
  }
  // Outside the lock: the answer may start another navigation, which holds again.
  decide(shouldStart);
  return true;
}

size_t NavigationLocks::pending() const {
  std::lock_guard lock(mutex_);
  return held_.size();
}

std::shared_ptr<NavigationLocks> sharedNavigationLocks() {
  static auto locks = std::make_shared<NavigationLocks>();
  return locks;
}

std::shared_ptr<NativeModule> makeWebViewModule(std::shared_ptr<NavigationLocks> locks) {
  struct WebViewModule : NativeModule {
    explicit WebViewModule(std::shared_ptr<NavigationLocks> locks) : NativeModule("RNCWebViewModule") {
      sync("shouldStartLoadWithLockIdentifier", [locks](const folly::dynamic &args) -> folly::dynamic {
        if (args.size() < 2 || !args[1].isNumber()) {
          return nullptr;
        }
        locks->settle(static_cast<int>(args[1].asDouble()), args[0].isBool() && args[0].asBool());
        return nullptr;
      });
    }
  };
  return std::make_shared<WebViewModule>(std::move(locks));
}

} // namespace ngn
