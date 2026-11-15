// An APNs payload as the core reads it (push.mm).
#include "../push.h"

#include <doctest/doctest.h>

TEST_CASE("a notification's userInfo becomes the JSON payload, numbers and booleans kept apart") {
  NSDictionary *userInfo = @{
    @"aps" : @{@"alert" : @{@"title" : @"Order", @"body" : @"Table 4"}, @"badge" : @3, @"content-available" : @1},
    @"orderId" : @42,
    @"price" : @4.5,
    @"paid" : @YES,
    @"items" : @[ @"tea", NSNull.null ],
    @"when" : [NSDate date],
  };
  auto payload = ngn::appkit::pushPayload(userInfo);
  CHECK(payload["aps"]["alert"]["title"] == "Order");
  CHECK(payload["aps"]["badge"] == 3);
  CHECK(payload["orderId"].isInt());
  CHECK(payload["orderId"] == 42);
  CHECK(payload["price"] == 4.5);
  CHECK(payload["paid"].isBool());
  CHECK(payload["paid"] == true);
  CHECK(payload["items"] == folly::dynamic::array("tea", nullptr));
  // What JSON cannot say is left out as null.
  CHECK(payload["when"].isNull());

  auto request = ngn::remoteNotificationRequest("apns-1", payload);
  CHECK(request.title == "Order");
  CHECK(request.badge == 3);
  CHECK(ngn::appkit::pushPayload(nil) == folly::dynamic::object());
}
