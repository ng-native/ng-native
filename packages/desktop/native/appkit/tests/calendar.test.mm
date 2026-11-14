// EventKitStore (calendar.mm) in the test binary, which has no Info.plist and so no usage string:
// it answers the access as macOS has it, and asking shows no prompt and changes nothing.
#include "../calendar.h"

#include <doctest/doctest.h>

#import <EventKit/EventKit.h>

using Access = ngn::CalendarStore::Access;
using Entity = ngn::CalendarStore::Entity;

TEST_CASE("EventKitStore asks for nothing without a usage string, and answers the access as it is") {
  auto store = ngn::appkit::makeCalendarStore();
  for (auto entity : {Entity::Event, Entity::Reminder}) {
    auto before = store->access(entity);
    std::optional<Access> answered;
    store->requestAccess(entity, false, [&](Access access) { answered = access; });
    // Answered at once, on this thread: nothing was shown.
    REQUIRE(answered);
    CHECK(*answered == before);
    CHECK(store->access(entity) == before);
  }
}

TEST_CASE("EventKitStore reads nothing without full access") {
  auto store = ngn::appkit::makeCalendarStore();
  if (store->access(Entity::Event) == Access::FullAccess) {
    MESSAGE("this test binary has full calendar access; the denied path is not checked");
    return;
  }
  CHECK(store->calendars(Entity::Event).empty());
  CHECK_FALSE(store->defaultCalendar());
  CHECK(store->events({"any"}, 0, 1e13).empty());
  CHECK_FALSE(store->event("any"));
  auto module = ngn::makeCalendarModule(store, true);
  std::optional<folly::dynamic> permission;
  module->callWithPromise("requestCalendarPermissionsAsync", folly::dynamic::array(false), {.resolve = [&](folly::dynamic v) { permission = v; }, .reject = {}});
  REQUIRE(permission);
  CHECK((*permission)["granted"] == folly::dynamic(false));
}
