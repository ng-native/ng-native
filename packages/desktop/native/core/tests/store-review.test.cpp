#include "ngn/store-review.h"

#include <doctest/doctest.h>

#include <optional>

using folly::dynamic;

namespace {

struct FakePrompt final : ngn::ReviewPrompt {
  int shown{0};
  void request() override {
    shown++;
  }
};

dynamic ask(const ngn::NativeModule &module, const std::string &method) {
  std::optional<dynamic> answer;
  module.callWithPromise(method, dynamic::array(), {.resolve = [&](dynamic v) { answer = v; }, .reject = {}});
  REQUIRE(answer);
  return *answer;
}

} // namespace

TEST_CASE("NgNativeStoreReview asks for a rating in a Mac App Store build") {
  auto prompt = std::make_shared<FakePrompt>();
  auto module = ngn::makeStoreReviewModule(prompt, false);
  CHECK(ask(*module, "isAvailableAsync") == dynamic(true));
  CHECK(ask(*module, "hasAction") == dynamic(true));
  CHECK(ask(*module, "requestReview") == dynamic(nullptr));
  CHECK(prompt->shown == 1);
  CHECK(module->call("storeUrl") == dynamic(nullptr));
}

TEST_CASE("NgNativeStoreReview is inert outside the Mac App Store, and with NGN_NO_PROMPTS") {
  auto module = ngn::makeStoreReviewModule(nullptr, false);
  CHECK(ask(*module, "isAvailableAsync") == dynamic(false));
  CHECK(ask(*module, "hasAction") == dynamic(false));
  CHECK(ask(*module, "requestReview") == dynamic(nullptr));
  auto prompt = std::make_shared<FakePrompt>();
  auto quiet = ngn::makeStoreReviewModule(prompt, true);
  ask(*quiet, "requestReview");
  CHECK(prompt->shown == 0);
}
