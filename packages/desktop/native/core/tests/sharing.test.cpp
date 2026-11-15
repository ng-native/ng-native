#include "ngn/sharing.h"

#include <doctest/doctest.h>

#include <optional>

using folly::dynamic;

namespace {

struct FakePicker final : ngn::SharePicker {
  std::vector<Request> shown;
  std::function<void(std::optional<std::string>)> pending;
  void show(const Request &request, std::function<void(std::optional<std::string>)> done) override {
    shown.push_back(request);
    pending = std::move(done);
  }
};

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer share(const ngn::NativeModule &module, dynamic request) {
  Answer answer;
  module.callWithPromise(
      "share", dynamic::array(request),
      {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

} // namespace

TEST_CASE("NgNativeSharing answers the service picked, or that the picker was dismissed") {
  auto picker = std::make_shared<FakePicker>();
  auto module = ngn::makeSharingModule(picker);
  Answer shared;
  module->callWithPromise(
      "share", dynamic::array(dynamic::object("url", "https://example.com")("title", "A")("message", "")),
      {.resolve = [&](dynamic v) { shared.value = v; }, .reject = {}});
  REQUIRE(picker->shown.size() == 1);
  CHECK(picker->shown[0].url == "https://example.com");
  CHECK(picker->shown[0].title == "A");
  CHECK_FALSE(picker->shown[0].message);
  CHECK(share(*module, dynamic::object("message", "again")).error);
  picker->pending("Messages");
  CHECK(shared.value == dynamic(dynamic::object("action", "sharedAction")("activityType", "Messages")));

  Answer dismissed;
  module->callWithPromise("share", dynamic::array(dynamic::object("message", "Hi")), {.resolve = [&](dynamic v) { dismissed.value = v; }, .reject = {}});
  picker->pending(std::nullopt);
  CHECK(dismissed.value == dynamic(dynamic::object("action", "dismissedAction")("activityType", nullptr)));
}

TEST_CASE("NgNativeSharing refuses a request with nothing to share") {
  auto picker = std::make_shared<FakePicker>();
  auto module = ngn::makeSharingModule(picker);
  CHECK(share(*module, dynamic::object("title", "A")).error);
  CHECK(share(*module, nullptr).error);
  CHECK(picker->shown.empty());
}

TEST_CASE("NgNativeSharing shows nothing with no prompts, answering as dismissed") {
  auto picker = std::make_shared<FakePicker>();
  auto module = ngn::makeSharingModule(picker, true);
  auto answer = share(*module, dynamic::object("message", "Hi"));
  CHECK(picker->shown.empty());
  CHECK(answer.value == dynamic(dynamic::object("action", "dismissedAction")("activityType", nullptr)));
}

TEST_CASE("NgNativeSharing shares a file only inside the file boundary, refusing one outside before showing anything") {
  auto picker = std::make_shared<FakePicker>();
  auto access = std::make_shared<ngn::FileAccess>(ngn::FileAccess::Folders{.cache = "/app/caches"}, dynamic::array());
  auto module = ngn::makeSharingModule(picker, false, access);
  for (const char *url : {"file:///Users/me/.ssh/id_ed25519", "/Users/me/.ssh/id_ed25519", "FILE:///Users/me/.ssh/id_ed25519",
                          "file://localhost/app/caches/a.pdf"}) {
    CAPTURE(url);
    auto refused = share(*module, dynamic::object("url", url));
    REQUIRE(refused.error);
    CHECK(refused.error->find("outside the files this app may read") != std::string::npos);
  }
  CHECK(picker->shown.empty());
  // The app's own file goes to the picker as the file uri checked; a web url as it is.
  share(*module, dynamic::object("url", "file:///app/caches/report%20one.pdf"));
  REQUIRE(picker->shown.size() == 1);
  CHECK(picker->shown[0].url == "file:///app/caches/report%20one.pdf");
  picker->pending(std::nullopt);
  share(*module, dynamic::object("url", "https://example.com"));
  CHECK(picker->shown[1].url == "https://example.com");
  // Without file access, no file at all.
  auto closed = ngn::makeSharingModule(picker, false);
  CHECK(share(*closed, dynamic::object("url", "file:///app/caches/a.pdf")).error);
}
