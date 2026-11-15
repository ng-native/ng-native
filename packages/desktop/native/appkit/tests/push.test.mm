// An APNs payload as the core reads it (push.mm).
#include "../push.h"

#include <doctest/doctest.h>

TEST_CASE("a notification's userInfo becomes the JSON payload, numbers and booleans kept apart") {
  const unichar key[] = {'a', 0, 'b'};
  const unichar value[] = {'c', 0, 'd'};
  NSDictionary *userInfo = @{
    @"aps" : @{@"alert" : @{@"title" : @"Order", @"body" : @"Table 4"}, @"badge" : @3, @"content-available" : @1},
    @"orderId" : @42,
    @"price" : @4.5,
    @"paid" : @YES,
    @"items" : @[ @"tea", NSNull.null, [NSDate date] ],
    @"when" : [NSDate date],
    @"nested" : @{@"alert" : [NSDate date]},
    [NSString stringWithCharacters:key length:3] : [NSString stringWithCharacters:value length:3],
    @"a" : @"plain",
  };
  auto payload = ngn::appkit::pushPayload(userInfo);
  CHECK(payload["aps"]["alert"]["title"] == "Order");
  CHECK(payload["aps"]["badge"] == 3);
  CHECK(payload["orderId"].isInt());
  CHECK(payload["orderId"] == 42);
  CHECK(payload["price"] == 4.5);
  CHECK(payload["paid"].isBool());
  CHECK(payload["paid"] == true);
  // What JSON cannot say is left out, key and all; a null stays.
  CHECK(payload["items"] == folly::dynamic::array("tea", nullptr));
  CHECK(payload.count("when") == 0);
  CHECK(payload["nested"] == folly::dynamic::object());
  // A U+0000 inside a key or a value keeps what follows it, and two keys stay apart.
  CHECK(payload.at(std::string("a\0b", 3)) == std::string("c\0d", 3));
  CHECK(payload.at("a") == "plain");

  auto request = ngn::remoteNotificationRequest("apns-1", payload);
  CHECK(request.title == "Order");
  CHECK(request.badge == 3);
  CHECK(ngn::appkit::pushPayload(nil) == folly::dynamic::object());
}
