// The notification centre over UNUserNotificationCenter and the Dock badge (notifications.h). The
// test binary has no bundle, so the centre itself is never touched: only what is built for it.
#include "../notifications.h"

#import <AppKit/AppKit.h>

#include <doctest/doctest.h>

TEST_CASE("A notification's content carries its badge, 0 included, so the OS sets it as it delivers") {
  ngn::NotificationRequest request{.identifier = "a", .title = "Hi", .body = "There", .badge = 5};
  UNMutableNotificationContent *content = ngn::appkit::notificationContent(request);
  CHECK([content.title isEqualToString:@"Hi"]);
  CHECK([content.badge isEqual:@5]);
  request.badge = 0;
  CHECK([ngn::appkit::notificationContent(request).badge isEqual:@0]);
  request.badge.reset();
  CHECK((ngn::appkit::notificationContent(request).badge == nil));
}

TEST_CASE("The badge reads back the last count set, whatever an earlier count's Dock drawing does") {
  [NSApplication sharedApplication];
  auto center = ngn::appkit::makeNotificationCenter(std::make_shared<ngn::NotificationEvents>("macos"));
  REQUIRE_FALSE(center->canPost());
  center->setBadge(1);
  // Runs after the first count's drawing and before the second's.
  __block int between = -1;
  dispatch_async(dispatch_get_main_queue(), ^{
    between = center->badge();
  });
  center->setBadge(2);
  NSDate *limit = [NSDate dateWithTimeIntervalSinceNow:5];
  while (between == -1 && [limit timeIntervalSinceNow] > 0) {
    [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  }
  CHECK(between == 2);
  CHECK(center->badge() == 2);
  center->setBadge(0);
}
