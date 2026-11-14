#include "ngn/calendar.h"

#include <doctest/doctest.h>

#include <optional>

using folly::dynamic;
using Access = ngn::CalendarStore::Access;
using Entity = ngn::CalendarStore::Entity;

namespace {

dynamic ask(const ngn::NativeModule &module, const std::string &method, dynamic args = dynamic::array()) {
  std::optional<dynamic> answer;
  module.callWithPromise(method, args, {.resolve = [&](dynamic v) { answer = v; }, .reject = {}});
  REQUIRE(answer);
  return *answer;
}

struct FakeStore final : ngn::CalendarStore {
  Access eventAccess{Access::NotDetermined};
  Access reminderAccess{Access::NotDetermined};
  // What the user decides when asked.
  Access decides{Access::FullAccess};
  std::vector<std::pair<Entity, bool>> asked;
  int reads{0};
  Source home{.id = "s1", .name = "iCloud", .type = "caldav"};

  Access access(Entity entity) override {
    return entity == Entity::Event ? eventAccess : reminderAccess;
  }
  void requestAccess(Entity entity, bool writeOnly, std::function<void(Access)> done) override {
    asked.emplace_back(entity, writeOnly);
    (entity == Entity::Event ? eventAccess : reminderAccess) = decides;
    done(decides);
  }
  std::vector<Calendar> calendars(Entity entity) override {
    reads++;
    if (entity == Entity::Reminder) {
      return {{.id = "r1", .title = "Tasks", .source = home, .type = "caldav", .color = "#00FF00"}};
    }
    return {{.id = "c1", .title = "Home", .source = home, .type = "caldav", .color = "#FF0000", .allowsModifications = true, .primary = true}};
  }
  std::optional<Calendar> defaultCalendar() override {
    reads++;
    return calendars(Entity::Event)[0];
  }
  std::vector<Source> sources() override {
    reads++;
    return {home};
  }
  std::vector<std::string> askedIds;
  std::vector<Event> events_(double start) {
    return {{.id = "e1", .calendarId = "c1", .title = "Padel", .notes = "", .start = start, .end = start + 3600000, .timeZone = "Europe/London"}};
  }
  std::vector<Event> events(const std::vector<std::string> &ids, double start, double end) override {
    reads++;
    askedIds = ids;
    return events_(start);
  }
  std::optional<Event> event(const std::string &id) override {
    reads++;
    return id == "e1" ? std::optional(events_(0)[0]) : std::nullopt;
  }
};

dynamic permission(const char *status, bool granted, bool canAskAgain) {
  return dynamic::object("status", status)("granted", granted)("canAskAgain", canAskAgain)("expires", "never");
}

} // namespace

TEST_CASE("NgNativeCalendar answers the permission as decided, with write-only access granting only a write-only ask") {
  auto store = std::make_shared<FakeStore>();
  auto module = ngn::makeCalendarModule(store, false);
  CHECK(ask(*module, "getCalendarPermissionsAsync") == permission("undetermined", false, true));
  store->eventAccess = Access::Denied;
  CHECK(ask(*module, "getCalendarPermissionsAsync") == permission("denied", false, false));
  store->eventAccess = Access::Restricted;
  CHECK(ask(*module, "getCalendarPermissionsAsync", dynamic::array(true)) == permission("denied", false, false));
  store->eventAccess = Access::WriteOnly;
  CHECK(ask(*module, "getCalendarPermissionsAsync", dynamic::array(true)) == permission("granted", true, false));
  CHECK(ask(*module, "getCalendarPermissionsAsync", dynamic::array(false)) == permission("undetermined", false, true));
  store->eventAccess = Access::FullAccess;
  CHECK(ask(*module, "getCalendarPermissionsAsync") == permission("granted", true, false));
  CHECK(ask(*module, "getRemindersPermissionsAsync") == permission("undetermined", false, true));
}

TEST_CASE("NgNativeCalendar asks only what can still be asked") {
  auto store = std::make_shared<FakeStore>();
  auto module = ngn::makeCalendarModule(store, false);
  store->decides = Access::Denied;
  CHECK(ask(*module, "requestCalendarPermissionsAsync", dynamic::array(false)) == permission("denied", false, false));
  CHECK(ask(*module, "requestCalendarPermissionsAsync", dynamic::array(false)) == permission("denied", false, false));
  store->decides = Access::FullAccess;
  CHECK(ask(*module, "requestRemindersPermissionsAsync") == permission("granted", true, false));
  CHECK(store->asked == std::vector<std::pair<Entity, bool>>{{Entity::Event, false}, {Entity::Reminder, false}});
}

TEST_CASE("NgNativeCalendar never asks with NGN_NO_PROMPTS") {
  auto store = std::make_shared<FakeStore>();
  auto module = ngn::makeCalendarModule(store, true);
  CHECK(ask(*module, "requestCalendarPermissionsAsync", dynamic::array(true)) == permission("undetermined", false, true));
  CHECK(ask(*module, "requestRemindersPermissionsAsync") == permission("undetermined", false, true));
  CHECK(store->asked.empty());
}

TEST_CASE("NgNativeCalendar reads nothing without full access") {
  for (auto access : {Access::NotDetermined, Access::Denied, Access::Restricted, Access::WriteOnly}) {
    auto store = std::make_shared<FakeStore>();
    store->eventAccess = access;
    auto module = ngn::makeCalendarModule(store, false);
    CHECK(ask(*module, "getCalendarsAsync", dynamic::array("event")) == dynamic::array());
    CHECK(ask(*module, "getCalendarAsync", dynamic::array("c1")) == dynamic(nullptr));
    CHECK(module->call("getDefaultCalendarSync") == dynamic(nullptr));
    CHECK(module->call("getSourcesSync") == dynamic::array());
    CHECK(ask(*module, "listEventsAsync", dynamic::array(dynamic::array("c1"), 0, 1)) == dynamic::array());
    CHECK(ask(*module, "getEventAsync", dynamic::array("e1")) == dynamic(nullptr));
    CHECK(store->reads == 0);
  }
}

TEST_CASE("NgNativeCalendar reads calendars and events in expo-calendar's shapes with full access") {
  auto store = std::make_shared<FakeStore>();
  store->eventAccess = Access::FullAccess;
  auto module = ngn::makeCalendarModule(store, false);
  auto calendars = ask(*module, "getCalendarsAsync", dynamic::array("event"));
  REQUIRE(calendars.size() == 1);
  CHECK(calendars[0]["id"] == dynamic("c1"));
  CHECK(calendars[0]["source"]["name"] == dynamic("iCloud"));
  CHECK(calendars[0]["sourceId"] == dynamic("s1"));
  CHECK(calendars[0]["entityType"] == dynamic("event"));
  CHECK(calendars[0]["isPrimary"] == dynamic(true));
  // Reminders keep their own permission.
  CHECK(ask(*module, "getCalendarsAsync", dynamic::array("reminder")) == dynamic::array());
  CHECK(module->call("getDefaultCalendarSync")["title"] == dynamic("Home"));
  CHECK(module->call("getSourcesSync")[0]["type"] == dynamic("caldav"));
  CHECK(ask(*module, "getCalendarAsync", dynamic::array("c1"))["title"] == dynamic("Home"));
  CHECK(ask(*module, "getCalendarAsync", dynamic::array("r1")) == dynamic(nullptr));

  auto events = ask(*module, "listEventsAsync", dynamic::array(dynamic::array("c1", 2), 1763112600000.0, 1763199000000.0));
  CHECK(store->askedIds == std::vector<std::string>{"c1"});
  REQUIRE(events.size() == 1);
  CHECK(events[0]["startDate"] == dynamic("2025-11-14T09:30:00.000Z"));
  CHECK(events[0]["endDate"] == dynamic("2025-11-14T10:30:00.000Z"));
  CHECK(events[0]["location"] == dynamic(nullptr));
  CHECK(events[0]["timeZone"] == dynamic("Europe/London"));
  CHECK(ask(*module, "getEventAsync", dynamic::array("e1"))["title"] == dynamic("Padel"));
  CHECK(ask(*module, "getEventAsync", dynamic::array("e2")) == dynamic(nullptr));
  CHECK(ask(*module, "listEventsAsync", dynamic::array(dynamic::array(), 0, 1)) == dynamic::array());
}

TEST_CASE("isoDate writes milliseconds as UTC ISO 8601") {
  CHECK(ngn::isoDate(0) == "1970-01-01T00:00:00.000Z");
  CHECK(ngn::isoDate(1763112600123.0) == "2025-11-14T09:30:00.123Z");
  CHECK(ngn::isoDate(-1000) == "1969-12-31T23:59:59.000Z");
}
