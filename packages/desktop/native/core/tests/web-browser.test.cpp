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

namespace {

// The browser and the prompt a LinkAuthSession drives: what was opened, whether the prompt is up,
// and its Cancel.
struct Desk {
  std::vector<std::string> opened;
  bool opens{true};
  bool promptUp{false};
  std::function<void()> cancelPrompt;
  std::shared_ptr<ngn::LinkAuthSession> session = std::make_shared<ngn::LinkAuthSession>(ngn::LinkAuthSession::Hooks{
      .openUrl =
          [this](const std::string &url, std::function<void(bool)> done) {
            opened.push_back(url);
            done(opens);
          },
      .prompt =
          [this](std::function<void()> cancelled) {
            promptUp = true;
            cancelPrompt = std::move(cancelled);
            return std::function<void()>([this] { promptUp = false; });
          }});
  std::optional<std::pair<std::optional<std::string>, std::string>> ended;
  void start(const std::string &scheme) {
    ended.reset();
    session->start({.url = "https://id.example/authorize", .callbackScheme = scheme},
                   [this](std::optional<std::string> url, std::string error) { ended = std::pair(std::move(url), std::move(error)); });
  }
};

} // namespace

TEST_CASE("A link auth session opens the page in the browser and ends on the first link back on its scheme, which only it hears") {
  Desk desk;
  desk.start("myapp");
  CHECK(desk.opened == std::vector<std::string>{"https://id.example/authorize"});
  CHECK(desk.promptUp);
  CHECK_FALSE(desk.ended);
  // Another app's link, or one on another scheme, is the app's own.
  CHECK_FALSE(desk.session->receive("otherapp://cb?code=1"));
  CHECK_FALSE(desk.session->receive("https://myapp.example/cb"));
  CHECK_FALSE(desk.ended);
  CHECK(desk.session->receive("MyApp://signed-in?code=42&state=s"));
  REQUIRE(desk.ended);
  CHECK(desk.ended->first == std::optional<std::string>("MyApp://signed-in?code=42&state=s"));
  CHECK(desk.ended->second.empty());
  CHECK_FALSE(desk.promptUp);
  // Once ended, a link on the scheme is the app's again.
  CHECK_FALSE(desk.session->receive("myapp://signed-in?code=43"));
}

TEST_CASE("A link auth session is cancelled by its prompt's Cancel or by cancel(), and refuses a second while one runs") {
  Desk desk;
  desk.start("myapp");
  std::optional<std::string> second;
  desk.session->start({.url = "https://id.example/again", .callbackScheme = "myapp"},
                      [&second](std::optional<std::string>, std::string error) { second = error; });
  CHECK(second == std::optional<std::string>("another authentication session is already open"));
  CHECK(desk.opened.size() == 1);
  desk.cancelPrompt();
  REQUIRE(desk.ended);
  CHECK_FALSE(desk.ended->first);
  CHECK(desk.ended->second.empty());
  CHECK_FALSE(desk.promptUp);

  desk.start("myapp");
  CHECK(desk.promptUp);
  desk.session->cancel();
  REQUIRE(desk.ended);
  CHECK_FALSE(desk.ended->first);
  CHECK_FALSE(desk.promptUp);
  // Cancelling with nothing running answers nothing.
  desk.ended.reset();
  desk.session->cancel();
  CHECK_FALSE(desk.ended);
}

TEST_CASE("A link auth session whose browser does not open ends with an error, and its prompt never stays up") {
  Desk desk;
  desk.opens = false;
  desk.start("myapp");
  REQUIRE(desk.ended);
  CHECK_FALSE(desk.ended->first);
  CHECK(desk.ended->second == "no browser opened https://id.example/authorize");
  CHECK_FALSE(desk.promptUp);
  // With no callback scheme only Cancel ends it.
  desk.opens = true;
  desk.start("");
  CHECK_FALSE(desk.session->receive("myapp://cb"));
  CHECK_FALSE(desk.ended);
  desk.session->cancel();
  CHECK(desk.ended);
}

TEST_CASE("NgNativeWebBrowser over a link auth session answers the redirect as success and a cancel as cancel") {
  Desk desk;
  auto module = ngn::makeWebBrowserModule(std::make_shared<ngn::testing::FakeSystem>(), desk.session, false);
  std::optional<dynamic> answer;
  module->callWithPromise("openAuthSessionAsync", dynamic::array("https://id.example/authorize", "myapp://signed-in"),
                          {.resolve = [&](dynamic v) { answer = v; }, .reject = [](const std::string &) {}});
  CHECK_FALSE(answer);
  CHECK(desk.session->receive("myapp://signed-in?code=7"));
  REQUIRE(answer);
  CHECK((*answer)["type"] == "success");
  CHECK((*answer)["url"] == "myapp://signed-in?code=7");
  answer.reset();
  module->callWithPromise("openAuthSessionAsync", dynamic::array("https://id.example/authorize", "myapp://signed-in"),
                          {.resolve = [&](dynamic v) { answer = v; }, .reject = [](const std::string &) {}});
  ask(*module, "dismissAuthSession", dynamic::array());
  REQUIRE(answer);
  CHECK((*answer)["type"] == "cancel");
}

TEST_CASE("A link auth session ignores the late answers of a session that was cancelled, and keeps the new one") {
  std::vector<std::function<void(bool)>> opens;
  std::vector<std::function<void()>> cancels;
  std::vector<bool> up;
  auto session = std::make_shared<ngn::LinkAuthSession>(ngn::LinkAuthSession::Hooks{
      .openUrl = [&](const std::string &, std::function<void(bool)> opened) { opens.push_back(std::move(opened)); },
      .prompt = [&](std::function<void()> cancelled) {
        cancels.push_back(std::move(cancelled));
        up.push_back(true);
        size_t index = up.size() - 1;
        return std::function<void()>([&up, index] { up[index] = false; });
      }});
  std::optional<std::pair<std::optional<std::string>, std::string>> first, second;
  session->start({.url = "https://id.example/a", .callbackScheme = "myapp"},
                 [&](std::optional<std::string> url, std::string error) { first = std::pair(std::move(url), std::move(error)); });
  session->cancel();
  REQUIRE(first);
  session->start({.url = "https://id.example/b", .callbackScheme = "myapp"},
                 [&](std::optional<std::string> url, std::string error) { second = std::pair(std::move(url), std::move(error)); });
  REQUIRE(opens.size() == 2);
  // The first session's browser and prompt answer late: the second is not theirs to end.
  opens[0](false);
  cancels[0]();
  CHECK_FALSE(second);
  CHECK(up[1]);
  // The second still ends on its own link and takes its own prompt away.
  CHECK(session->receive("myapp://done"));
  REQUIRE(second);
  CHECK(second->first == std::optional<std::string>("myapp://done"));
  CHECK_FALSE(up[1]);
}

TEST_CASE("A link auth session takes away the prompt of a session that ended while it was being shown") {
  std::shared_ptr<ngn::LinkAuthSession> session;
  std::vector<bool> up;
  bool replaced = false;
  session = std::make_shared<ngn::LinkAuthSession>(ngn::LinkAuthSession::Hooks{
      .openUrl = [](const std::string &, std::function<void(bool)>) {},
      .prompt = [&](std::function<void()>) {
        // The session is cancelled and another begins before the first one's prompt is handed back.
        if (!std::exchange(replaced, true)) {
          session->cancel();
          session->start({.url = "https://id.example/b", .callbackScheme = "myapp"}, [](std::optional<std::string>, std::string) {});
        }
        up.push_back(true);
        size_t index = up.size() - 1;
        return std::function<void()>([&up, index] { up[index] = false; });
      }});
  session->start({.url = "https://id.example/a", .callbackScheme = "myapp"}, [](std::optional<std::string>, std::string) {});
  REQUIRE(up.size() == 2);
  // The inner start's prompt is up[0], handed back first; the outer (stale) one is up[1].
  CHECK(up[0]);
  CHECK_FALSE(up[1]);
  session->cancel();
  CHECK_FALSE(up[0]);
}
