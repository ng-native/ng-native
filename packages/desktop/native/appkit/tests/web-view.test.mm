// NGNWebViewController (web-view.mm) on a WKWebView that is never shown, loading local HTML: the
// navigation lock, the load events, injected scripts and messages both ways, and originWhitelist.
#include "../web-view.h"

#include <doctest/doctest.h>

#import <Foundation/Foundation.h>

#include <chrono>
#include <filesystem>
#include <fstream>

namespace {

template <typename Done>
bool runUntil(Done done, double limit) {
  auto end = std::chrono::steady_clock::now() + std::chrono::duration<double>(limit);
  while (!done()) {
    if (std::chrono::steady_clock::now() > end) {
      return false;
    }
    [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  }
  return true;
}

// A controller whose events are kept in order, answering each navigation with `allow` when it
// is set, as the app's JavaScript would through RNCWebViewModule.
struct Harness {
  std::shared_ptr<ngn::NavigationLocks> locks = std::make_shared<ngn::NavigationLocks>();
  std::shared_ptr<ngn::NativeModule> module = ngn::makeWebViewModule(locks);
  std::vector<std::pair<std::string, folly::dynamic>> events;
  std::vector<std::string> opened;
  std::optional<bool> allow{true};
  NGNWebViewController *controller;

  Harness() {
    controller = [[NGNWebViewController alloc] initWithLocks:locks
        send:[this](const std::string &name, folly::dynamic payload) {
          events.emplace_back(name, payload);
          if (name == "shouldStartLoadWithRequest" && allow) {
            module->call("shouldStartLoadWithLockIdentifier", folly::dynamic::array(*allow, payload["lockIdentifier"]));
          }
        }
        openExternally:[this](const std::string &url) { opened.push_back(url); }];
  }
  ~Harness() {
    [controller invalidate];
  }

  size_t count(const std::string &name) const {
    return std::count_if(events.begin(), events.end(), [&](const auto &e) { return e.first == name; });
  }
  std::vector<std::string> messages() const {
    std::vector<std::string> out;
    for (const auto &[name, payload] : events) {
      if (name == "message") {
        out.push_back(payload["data"].asString());
      }
    }
    return out;
  }
  // The last event named `name`.
  folly::dynamic last(const std::string &name) const {
    for (auto it = events.rbegin(); it != events.rend(); ++it) {
      if (it->first == name) {
        return it->second;
      }
    }
    return nullptr;
  }
  bool waitFor(const std::string &name, size_t times = 1, double limit = 15) {
    return runUntil([&] { return count(name) >= times; }, limit);
  }
};

ngn::WebViewConfig page(std::string html) {
  ngn::WebViewConfig config;
  config.source.html = std::move(html);
  config.messagingEnabled = true;
  return config;
}

} // namespace

TEST_CASE("NGNWebViewController loads HTML once the app allows the navigation, and sends the load events") {
  Harness harness;
  harness.allow = std::nullopt;
  [harness.controller apply:page("<title>Hello</title><p>Hi</p>")];
  REQUIRE(harness.waitFor("shouldStartLoadWithRequest"));
  const auto &asked = harness.events.back().second;
  CHECK(asked["url"] == "about:blank");
  CHECK(asked["isTopFrame"] == true);
  CHECK(asked["navigationType"] == "other");
  CHECK(harness.locks->pending() == 1);
  CHECK(harness.count("loadingStart") == 0);

  harness.module->call("shouldStartLoadWithLockIdentifier", folly::dynamic::array(true, asked["lockIdentifier"]));
  REQUIRE(harness.waitFor("loadingFinish"));
  CHECK(harness.count("loadingStart") == 1);
  auto finished = harness.last("loadingFinish");
  // The title is WebKit's to set after the load, as on iOS.
  CHECK(finished["url"] == "about:blank");
  CHECK(finished["loading"] == false);
  CHECK(finished["canGoBack"] == false);
}

TEST_CASE("NGNWebViewController stops a navigation the app refuses, and refuses what it still holds when invalidated") {
  Harness harness;
  harness.allow = false;
  [harness.controller apply:page("<p>Never</p>")];
  REQUIRE(harness.waitFor("shouldStartLoadWithRequest"));
  runUntil([] { return false; }, 0.5);
  CHECK(harness.count("loadingStart") == 0);
  CHECK(harness.count("loadingFinish") == 0);

  Harness held;
  held.allow = std::nullopt;
  [held.controller apply:page("<p>Held</p>")];
  REQUIRE(held.waitFor("shouldStartLoadWithRequest"));
  [held.controller invalidate];
  CHECK(held.locks->pending() == 0);
  // WebKit is answered on the main thread; nothing is left waiting for it.
  runUntil([] { return false; }, 0.2);
}

TEST_CASE("NGNWebViewController runs the injected scripts and sends the page's messages, and posts the app's into the page") {
  Harness harness;
  auto config = page(
      "<script>window.addEventListener('message', function (e) {"
      "  window.ReactNativeWebView.postMessage('echo:' + e.data); });"
      "window.ReactNativeWebView.postMessage('inline:' + window.beforeRan);</script>");
  config.injectedJavaScriptBeforeContentLoaded = "window.beforeRan = 'yes';";
  config.injectedJavaScript = "window.ReactNativeWebView.postMessage('after:' + document.readyState); true;";
  config.injectedJavaScriptObject = R"({"user":"Ada"})";
  [harness.controller apply:config];
  REQUIRE(harness.waitFor("message", 2));
  CHECK(harness.messages()[0] == "inline:yes");
  CHECK(harness.messages()[1].rfind("after:", 0) == 0);

  [harness.controller command:"postMessage" args:folly::dynamic::array("hi \"there\"\n")];
  REQUIRE(harness.waitFor("message", 3));
  CHECK(harness.messages()[2] == "echo:hi \"there\"\n");

  [harness.controller command:"injectJavaScript"
                         args:folly::dynamic::array("window.ReactNativeWebView.postMessage(window.ReactNativeWebView.injectedObjectJson())")];
  REQUIRE(harness.waitFor("message", 4));
  CHECK(harness.messages()[3] == R"({"user":"Ada"})");
}

TEST_CASE("NGNWebViewController gives the page no bridge without messagingEnabled") {
  Harness harness;
  auto config = page("<p>x</p>");
  config.messagingEnabled = false;
  config.injectedJavaScript = "document.title = typeof window.ReactNativeWebView; true;";
  [harness.controller apply:config];
  REQUIRE(harness.waitFor("loadingFinish"));
  runUntil([&] { return harness.controller.webView.title.length > 0; }, 5);
  CHECK([harness.controller.webView.title isEqualToString:@"undefined"]);
  CHECK(harness.messages().empty());
}

TEST_CASE("NGNWebViewController hands a page navigation outside originWhitelist to the OS without asking the app") {
  Harness harness;
  auto config = page("<a href='mailto:me@example.com'>mail</a><a id='web' href='https://example.com/'>web</a>");
  config.originWhitelist = std::vector<std::string>{"https://*"};
  [harness.controller apply:config];
  REQUIRE(harness.waitFor("loadingFinish"));
  auto asked = harness.count("shouldStartLoadWithRequest");
  harness.allow = false;
  [harness.controller command:"injectJavaScript" args:folly::dynamic::array("document.querySelector('a').click()")];
  REQUIRE(runUntil([&] { return !harness.opened.empty(); }, 10));
  CHECK(harness.opened[0] == "mailto:me@example.com");
  CHECK(harness.count("shouldStartLoadWithRequest") == asked);

  [harness.controller command:"injectJavaScript" args:folly::dynamic::array("document.getElementById('web').click()")];
  REQUIRE(harness.waitFor("shouldStartLoadWithRequest", asked + 1));
  CHECK(harness.last("shouldStartLoadWithRequest")["url"] == "https://example.com/");
  CHECK(harness.last("shouldStartLoadWithRequest")["navigationType"] == "click");
  CHECK(harness.opened.size() == 1);
}

TEST_CASE("NGNWebViewController loads a local file, and reports one that is not there as a loading error") {
  auto folder = std::filesystem::temp_directory_path() / ("ngn-web-view-" + std::to_string(rand()));
  std::filesystem::create_directories(folder);
  std::ofstream(folder / "page.html") << "<title>File</title>";
  Harness harness;
  ngn::WebViewConfig config;
  config.source.uri = "file://" + (folder / "page.html").string();
  [harness.controller apply:config];
  REQUIRE(harness.waitFor("loadingFinish"));
  CHECK(harness.last("loadingFinish")["url"] == config.source.uri);
  CHECK(harness.last("loadingProgress")["progress"] == 1.0);

  // A source that did not change does not load again; a new one does.
  [harness.controller apply:config];
  config.source.uri = "file://" + (folder / "missing.html").string();
  [harness.controller apply:config];
  REQUIRE(harness.waitFor("loadingError"));
  CHECK(harness.count("loadingFinish") == 1);
  auto error = harness.last("loadingError");
  CHECK(error["code"].asInt() != 0);
  CHECK_FALSE(error["description"].asString().empty());
  std::filesystem::remove_all(folder);
}
