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
