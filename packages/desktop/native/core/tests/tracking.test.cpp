#include "ngn/tracking.h"

#include <doctest/doctest.h>

#include <optional>

using folly::dynamic;
using Access = ngn::TrackingAuthority::Access;

namespace {

struct FakeAuthority final : ngn::TrackingAuthority {
  Access now{Access::NotDetermined};
  int asked{0};
  std::string id{"6D92078A-8246-4BA4-AE5B-76104861E7DC"};
  Access access() override {
    return now;
  }
  void requestAccess(std::function<void(Access)> done) override {
    asked++;
    now = Access::Granted;
    done(now);
  }
  std::string advertisingId() override {
    return id;
  }
};

dynamic ask(const ngn::NativeModule &module, const std::string &method) {
  std::optional<dynamic> answer;
  module.callWithPromise(method, dynamic::array(), {.resolve = [&](dynamic v) { answer = v; }, .reject = {}});
  REQUIRE(answer);
  return *answer;
}

} // namespace

TEST_CASE("NgNativeTrackingTransparency asks only what is undetermined, and never with no prompts") {
  auto authority = std::make_shared<FakeAuthority>();
  auto quiet = ngn::makeTrackingModule(authority, true);
  CHECK(ask(*quiet, "requestTrackingPermissionsAsync")["status"] == dynamic("undetermined"));
  CHECK(quiet->call("getAdvertisingId") == dynamic(nullptr));
  CHECK(authority->asked == 0);
  auto module = ngn::makeTrackingModule(authority, false);
  CHECK(module->call("isAvailable") == dynamic(true));
  CHECK(ask(*module, "requestTrackingPermissionsAsync")["granted"] == dynamic(true));
  ask(*module, "requestTrackingPermissionsAsync");
  CHECK(authority->asked == 1);
  CHECK(module->call("getAdvertisingId") == dynamic(authority->id));
  // macOS answers zeros where it has no identifier.
  authority->id = "00000000-0000-0000-0000-000000000000";
  CHECK(module->call("getAdvertisingId") == dynamic(nullptr));
}

TEST_CASE("NgNativeTrackingTransparency answers a denial as denied, with no identifier") {
  auto authority = std::make_shared<FakeAuthority>();
  authority->now = Access::Denied;
  auto module = ngn::makeTrackingModule(authority, false);
  auto denied = ask(*module, "requestTrackingPermissionsAsync");
  CHECK(denied["status"] == dynamic("denied"));
  CHECK(denied["canAskAgain"] == dynamic(false));
  CHECK(authority->asked == 0);
  CHECK(module->call("getAdvertisingId") == dynamic(nullptr));
}
