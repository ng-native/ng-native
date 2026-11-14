#include "fake-system.h"
#include "ngn/web-browser.h"

#include <doctest/doctest.h>

#include <optional>

using folly::dynamic;

namespace {

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer ask(const ngn::NativeModule &module, const std::string &method, dynamic args) {
  Answer answer;
  module.callWithPromise(
      method, args,
      {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

struct FakeSession final : ngn::AuthSession {
  std::vector<Request> started;
  std::function<void(std::optional<std::string>, std::string)> pending;
  void start(const Request &request, std::function<void(std::optional<std::string>, std::string)> done) override {
    started.push_back(request);
    pending = std::move(done);
  }
  void cancel() override {
    if (pending) {
      auto done = std::move(pending);
      pending = nullptr;
      done(std::nullopt, "");
    }
  }
};

} // namespace

TEST_CASE("NgNativeWebBrowser opens an http or https url in the default browser") {
  auto system = std::make_shared<ngn::testing::FakeSystem>();
  auto module = ngn::makeWebBrowserModule(system, nullptr, false);
  CHECK(ask(*module, "openBrowserAsync", dynamic::array("https://example.com/a")).value == dynamic(dynamic::object("type", "opened")));
  CHECK(system->log == std::vector<std::string>{"open https://example.com/a"});
  // http has no browser in the fake: the call says nothing opened it.
  CHECK(ask(*module, "openBrowserAsync", dynamic::array("http://example.com")).error);
  for (const char *refused : {"file:///etc/passwd", "javascript:alert(1)", "mailto:a@b.c", "myapp://x", "https:", "example.com"}) {
    CHECK(ask(*module, "openBrowserAsync", dynamic::array(refused)).error);
  }
  CHECK(system->log.size() == 2);
  CHECK(ask(*module, "dismissBrowser", dynamic::array()).value == dynamic(dynamic::object("type", "dismiss")));
}

TEST_CASE("NgNativeWebBrowser runs one sign-in at a time, ending on the redirect's scheme") {
  auto sessions = std::make_shared<FakeSession>();
  auto module = ngn::makeWebBrowserModule(std::make_shared<ngn::testing::FakeSystem>(), sessions, false);
  Answer first;
  module->callWithPromise(
      "openAuthSessionAsync", dynamic::array("https://id.example.com/auth", "MyApp://signed-in", dynamic::object("preferEphemeralSession", true)),
      {.resolve = [&](dynamic v) { first.value = v; }, .reject = {}});
  REQUIRE(sessions->started.size() == 1);
  CHECK(sessions->started[0].callbackScheme == "myapp");
  CHECK(sessions->started[0].ephemeral);
  CHECK(ask(*module, "openAuthSessionAsync", dynamic::array("https://id.example.com/auth", "myapp://")).error);
  sessions->pending("myapp://signed-in?code=1", "");
  CHECK(first.value == dynamic(dynamic::object("type", "success")("url", "myapp://signed-in?code=1")));

  Answer second;
  module->callWithPromise(
      "openAuthSessionAsync", dynamic::array("https://id.example.com/auth", "myapp://"),
      {.resolve = [&](dynamic v) { second.value = v; }, .reject = {}});
  CHECK_FALSE(sessions->started[1].ephemeral);
  ask(*module, "dismissAuthSession", dynamic::array());
  CHECK(second.value == dynamic(dynamic::object("type", "cancel")));
  CHECK(ask(*module, "openAuthSessionAsync", dynamic::array("javascript:x", "myapp://")).error);
}

TEST_CASE("NgNativeWebBrowser never starts a sign-in with NGN_NO_PROMPTS") {
  auto sessions = std::make_shared<FakeSession>();
  auto module = ngn::makeWebBrowserModule(std::make_shared<ngn::testing::FakeSystem>(), sessions, true);
  CHECK(ask(*module, "openAuthSessionAsync", dynamic::array("https://id.example.com", "myapp://")).value ==
        dynamic(dynamic::object("type", "cancel")));
  CHECK(sessions->started.empty());
}

TEST_CASE("NgNativeWebBrowser reports a sign-in that could not start, and can start another") {
  auto sessions = std::make_shared<FakeSession>();
  auto module = ngn::makeWebBrowserModule(std::make_shared<ngn::testing::FakeSystem>(), sessions, false);
  Answer failed;
  module->callWithPromise(
      "openAuthSessionAsync", dynamic::array("https://id.example.com", "myapp://"),
      {.resolve = {}, .reject = [&](const std::string &e) { failed.error = e; }});
  sessions->pending(std::nullopt, "no window to present it in");
  REQUIRE(failed.error);
  CHECK(failed.error->find("no window") != std::string::npos);
  module->callWithPromise("openAuthSessionAsync", dynamic::array("https://id.example.com", "myapp://"), {.resolve = {}, .reject = {}});
  CHECK(sessions->started.size() == 2);
}
