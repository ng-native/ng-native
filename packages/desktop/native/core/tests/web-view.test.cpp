#include "ngn/web-view.h"

#include <doctest/doctest.h>

#include <folly/json.h>

using folly::dynamic;

TEST_CASE("webViewOrigin reads the scheme and authority as the library's JavaScript does") {
  CHECK(ngn::webViewOrigin("https://example.com/a/b?c") == "https://example.com");
  CHECK(ngn::webViewOrigin("http://localhost:8081") == "http://localhost:8081");
  CHECK(ngn::webViewOrigin("mailto:me@example.com") == "mailto:me@example.com");
  CHECK(ngn::webViewOrigin("file:///Users/me/a.html") == "file://");
  CHECK(ngn::webViewOrigin("not a url") == "");
}

TEST_CASE("passesOriginWhitelist matches each pattern from the start of the origin, * matching anything") {
  std::vector<std::string> web{"http://*", "https://*"};
  CHECK(ngn::passesOriginWhitelist(web, "https://example.com/page"));
  CHECK(ngn::passesOriginWhitelist(web, "http://localhost:3000/"));
  CHECK_FALSE(ngn::passesOriginWhitelist(web, "mailto:me@example.com"));
  CHECK_FALSE(ngn::passesOriginWhitelist(web, "tel:123"));
  std::vector<std::string> one{"https://*.example.com"};
  CHECK(ngn::passesOriginWhitelist(one, "https://docs.example.com/x"));
  CHECK_FALSE(ngn::passesOriginWhitelist(one, "https://example.org/x"));
  // A dot in a pattern is a dot, not any character.
  CHECK_FALSE(ngn::passesOriginWhitelist({"https://a.b"}, "https://axb/"));
  // The page `html` makes, and data urls, always pass.
  CHECK(ngn::passesOriginWhitelist({}, "about:blank"));
  CHECK(ngn::passesOriginWhitelist({}, "data:text/html,hi"));
  CHECK_FALSE(ngn::passesOriginWhitelist({}, "https://example.com"));
}

TEST_CASE("navigationStep hands a clicked page navigation outside originWhitelist to the OS, and asks the app about the rest") {
  ngn::WebViewConfig config;
  // No whitelist set: every navigation is the app's to decide.
  CHECK(ngn::navigationStep(config, "mailto:me@example.com", true, "other") == ngn::NavigationStep::AskApp);
  config.originWhitelist = std::vector<std::string>{"https://*"};
  CHECK(ngn::navigationStep(config, "https://example.com", true, "other") == ngn::NavigationStep::AskApp);
  CHECK(ngn::navigationStep(config, "mailto:me@example.com", true, "click") == ngn::NavigationStep::OpenExternally);
  CHECK(ngn::navigationStep(config, "mailto:me@example.com", true, "formsubmit") == ngn::NavigationStep::OpenExternally);
  // A frame inside the page is not a page navigation.
  CHECK(ngn::navigationStep(config, "http://ads.example.com", false, "other") == ngn::NavigationStep::AskApp);
}

TEST_CASE("navigationStep lets a navigation go ahead without asking the app when asksApp is off, inside originWhitelist") {
  ngn::WebViewConfig config;
  config.asksApp = false;
  CHECK(ngn::navigationStep(config, "https://example.com", true, "other") == ngn::NavigationStep::Allow);
  CHECK(ngn::navigationStep(config, "http://ads.example.com", false, "other") == ngn::NavigationStep::Allow);
  config.originWhitelist = std::vector<std::string>{"https://*"};
  CHECK(ngn::navigationStep(config, "https://example.com", true, "other") == ngn::NavigationStep::Allow);
  CHECK(ngn::navigationStep(config, "mailto:me@example.com", true, "click") == ngn::NavigationStep::OpenExternally);
  CHECK(ngn::navigationStep(config, "smb://attacker/share", true, "other") == ngn::NavigationStep::Cancel);
}

TEST_CASE("navigationStep cancels a navigation outside originWhitelist that no click made, or that Linking would refuse") {
  ngn::WebViewConfig config;
  config.originWhitelist = std::vector<std::string>{"https://*"};
  // A script setting location on load: no user activation.
  CHECK(ngn::navigationStep(config, "smb://attacker/share", true, "other") == ngn::NavigationStep::Cancel);
  CHECK(ngn::navigationStep(config, "mailto:me@example.com", true, "reload") == ngn::NavigationStep::Cancel);
  CHECK(ngn::navigationStep(config, "mailto:me@example.com", true, "backforward") == ngn::NavigationStep::Cancel);
  CHECK(ngn::navigationStep(config, "mailto:me@example.com", true, "formresubmit") == ngn::NavigationStep::Cancel);
  // Clicked, but a scheme Linking refuses.
  CHECK(ngn::navigationStep(config, "file:///System/Applications/Calculator.app", true, "click") == ngn::NavigationStep::Cancel);
  CHECK(ngn::navigationStep(config, "FILE:///System/Applications/Calculator.app", true, "click") == ngn::NavigationStep::Cancel);
  CHECK(ngn::navigationStep(config, "javascript:alert(1)", true, "click") == ngn::NavigationStep::Cancel);
  CHECK(ngn::navigationStep(config, "vbscript:x", true, "formsubmit") == ngn::NavigationStep::Cancel);
  CHECK(ngn::navigationStep(config, "blob:https://a/b", true, "click") == ngn::NavigationStep::Cancel);
}

TEST_CASE("The page scripts give it the library's bridge, and postMessage dispatches a MessageEvent with the data as JSON") {
  CHECK(ngn::webViewMessagingScript().find("window.webkit.messageHandlers.ReactNativeWebView.postMessage(String(data))") != std::string::npos);
  CHECK(ngn::webViewPostMessageScript("say \"hi\"\n") == R"(window.dispatchEvent(new MessageEvent('message', {"data":"say \"hi\"\n"}));)");
  CHECK(ngn::webViewInjectedObjectScript(R"({"a":1})").find(R"(return "{\"a\":1}";)") != std::string::npos);
}

TEST_CASE("webViewEvent carries what the library's iOS view puts in every event") {
  auto event = ngn::webViewEvent({.url = "https://a", .title = "A", .loading = true, .canGoBack = true});
  CHECK(event == dynamic::object("url", "https://a")("title", "A")("loading", true)("canGoBack", true)("canGoForward", false));
}

TEST_CASE("NavigationLocks holds each navigation until RNCWebViewModule answers its lock, once") {
  auto locks = std::make_shared<ngn::NavigationLocks>();
  auto module = ngn::makeWebViewModule(locks);
  std::vector<bool> answers;
  int first = locks->hold([&](bool start) { answers.push_back(start); });
  int second = locks->hold([&](bool start) { answers.push_back(start); });
  CHECK(first != second);
  CHECK(locks->pending() == 2);
  module->call("shouldStartLoadWithLockIdentifier", dynamic::array(false, second));
  module->call("shouldStartLoadWithLockIdentifier", dynamic::array(true, static_cast<double>(first)));
  CHECK(answers == std::vector<bool>{false, true});
  CHECK(locks->pending() == 0);
  // An answer for a lock no longer held does nothing.
  module->call("shouldStartLoadWithLockIdentifier", dynamic::array(true, first));
  CHECK_FALSE(locks->settle(first, true));
  CHECK(answers.size() == 2);
  // An answer may hold the next navigation from inside it.
  int third = locks->hold([&](bool) { locks->hold([](bool) {}); });
  CHECK(locks->settle(third, true));
  CHECK(locks->pending() == 1);
}

TEST_CASE("webViewFile loads a page from a file only inside the file boundary, reading no further than the app may") {
  ngn::FileAccess access({.cache = "/app/caches", .bundle = "/App.app/Contents/Resources"}, dynamic::array());
  // Not a file: nothing to check.
  CHECK_FALSE(ngn::webViewFile(&access, "https://example.com/"));
  CHECK_FALSE(ngn::webViewFile(&access, "about:blank"));

  // A page in the app's folders reads its own folder; one in the bundle too.
  auto cached = ngn::webViewFile(&access, "file:///app/caches/site/index.html?x=1");
  REQUIRE(cached);
  CHECK(cached->uri == "file:///app/caches/site/index.html");
  CHECK(cached->readAccess == "file:///app/caches/site/");
  auto bundled = ngn::webViewFile(&access, "/App.app/Contents/Resources/web/a.html");
  REQUIRE(bundled);
  CHECK(bundled->readAccess == "file:///App.app/Contents/Resources/web/");
  // A picked file reads only itself, not the folder it sits in.
  access.allowPicked("/Users/me/Desktop/page.html");
  auto picked = ngn::webViewFile(&access, "file:///Users/me/Desktop/page.html");
  REQUIRE(picked);
  CHECK(picked->readAccess == "file:///Users/me/Desktop/page.html");

  // Anything else is refused, however it is spelled.
  CHECK_THROWS_AS(ngn::webViewFile(&access, "file:///etc/hosts"), ngn::FileRefused);
  CHECK_THROWS_AS(ngn::webViewFile(&access, "FILE:///Users/me/Desktop/other.html"), ngn::FileRefused);
  CHECK_THROWS_AS(ngn::webViewFile(&access, "file://localhost/app/caches/site/index.html"), ngn::FileRefused);
  CHECK_THROWS_AS(ngn::webViewFile(nullptr, "file:///app/caches/site/index.html"), ngn::FileRefused);
}
