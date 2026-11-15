// AppTracking (tracking.mm) in the test binary, which has no Info.plist and so no usage string.
#include "../tracking.h"

#include <doctest/doctest.h>

TEST_CASE("AppTracking asks for nothing without a usage string, and gives no identifier without access") {
  auto authority = ngn::appkit::makeTrackingAuthority();
  auto before = authority->access();
  std::optional<ngn::TrackingAuthority::Access> answered;
  authority->requestAccess([&](ngn::TrackingAuthority::Access access) { answered = access; });
  // Answered at once, on this thread: nothing was shown.
  REQUIRE(answered);
  CHECK(*answered == before);
  if (before != ngn::TrackingAuthority::Access::Granted) {
    CHECK(ngn::makeTrackingModule(authority, false)->call("getAdvertisingId") == folly::dynamic(nullptr));
  }
}
