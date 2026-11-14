// react-native-webview's RNCWebView on a desktop host: what the core decides for a web view, apart
// from the toolkit's web engine. The host compiles the component in only with the library
// (`build.sh --library`, core/src/libraries/RNCWebViewSpec.cpp), which reads the library's props
// into a WebViewConfig; the backend's view loads it into its engine (WKWebView on macOS) and sends
// the library's iOS events: loadingStart, loadingFinish, loadingError, loadingProgress, httpError,
// message, shouldStartLoadWithRequest, openWindow and contentProcessDidTerminate.
//
// As on iOS, every navigation waits for the app: shouldStartLoadWithRequest carries a
// `lockIdentifier`, and the navigation goes ahead or stops once the app answers
// RNCWebViewModule.shouldStartLoadWithLockIdentifier(shouldStart, lockIdentifier). On a desktop
// host the view also takes `originWhitelist`, which the library's JavaScript applies on iOS and
// Android: a page navigation to an origin it does not match is not made, and the url is handed to
// the OS to open, as the library's JavaScript does with Linking.
#pragma once

#include "ngn/native-module.h"

#include <folly/dynamic.h>

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace ngn {

struct WebViewSource {
  std::string uri;
  std::string method;
  std::string body;
  std::vector<std::pair<std::string, std::string>> headers;
  std::string html;
  std::string baseUrl;
  bool operator==(const WebViewSource &) const = default;
};

struct WebViewConfig {
  WebViewSource source;
  std::string injectedJavaScript;
  std::string injectedJavaScriptBeforeContentLoaded;
  bool injectedJavaScriptForMainFrameOnly{true};
  bool injectedJavaScriptBeforeContentLoadedForMainFrameOnly{true};
  // window.ReactNativeWebView.injectedObjectJson()'s answer, when set.
  std::string injectedJavaScriptObject;
  bool messagingEnabled{false};
  bool javaScriptEnabled{true};
  bool javaScriptCanOpenWindowsAutomatically{false};
  bool hasOnOpenWindowEvent{false};
  bool incognito{false};
  bool webviewDebuggingEnabled{false};
  bool allowsBackForwardNavigationGestures{false};
  std::string userAgent;
  std::string applicationNameForUserAgent;
  // Nothing when the prop is not set, and then no origin is refused.
  std::optional<std::vector<std::string>> originWhitelist;
  bool operator==(const WebViewConfig &) const = default;
};

// The origin the library's JavaScript compares (extractOrigin): the scheme and, for a url with
// one, its authority, as written. Empty for a string with no scheme.
std::string webViewOrigin(const std::string &url);

// Whether `url`'s origin matches one of `whitelist`'s patterns, `*` matching anything, from the
// start of the origin, as the library's JavaScript compares them. `about:` and `data:` urls, which
// a page made from `html` is at, always do.
bool passesOriginWhitelist(const std::vector<std::string> &whitelist, const std::string &url);

// What a navigation to `url` waits for: the app's answer, or nothing, since it is to be handed to
// the OS instead (a page navigation outside `originWhitelist`).
enum class NavigationStep { AskApp, OpenExternally };
NavigationStep navigationStep(const WebViewConfig &config, const std::string &url, bool topFrame);

// The script, at document start, that gives the page window.ReactNativeWebView.postMessage, sent
// to the host's script message handler named "ReactNativeWebView" as a string.
std::string webViewMessagingScript();
// The script that gives the page window.ReactNativeWebView.injectedObjectJson().
std::string webViewInjectedObjectScript(const std::string &json);
// The script `postMessage(data)` runs in the page: a MessageEvent on the window.
std::string webViewPostMessageScript(const std::string &data);

// What every event carries, as the library's iOS view builds it (baseEvent).
struct WebViewState {
  std::string url;
  std::string title;
  bool loading{false};
  bool canGoBack{false};
  bool canGoForward{false};
};
folly::dynamic webViewEvent(const WebViewState &state);

// The navigations waiting for the app, by lock identifier, shared by every web view and
// RNCWebViewModule. Any thread.
class NavigationLocks {
 public:
  // Holds a navigation until `decide` is answered; returns its lock identifier.
  int hold(std::function<void(bool shouldStart)> decide);
  // Answers the navigation held as `lock`, once; false for a lock not held.
  bool settle(int lock, bool shouldStart);
  // How many navigations wait.
  size_t pending() const;

 private:
  mutable std::mutex mutex_;
  std::map<int, std::function<void(bool)>> held_;
  int next_{1};
};

// RNCWebViewModule: shouldStartLoadWithLockIdentifier(shouldStart, lockIdentifier).
std::shared_ptr<NativeModule> makeWebViewModule(std::shared_ptr<NavigationLocks> locks);

// The locks every web view in the host shares.
std::shared_ptr<NavigationLocks> sharedNavigationLocks();

} // namespace ngn
