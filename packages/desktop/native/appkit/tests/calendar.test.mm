// EventKitStore (calendar.mm) in the test binary, which has no Info.plist and so no usage string:
// it answers the access as macOS has it, and asking shows no prompt and changes nothing.
#include "../calendar.h"

#include <doctest/doctest.h>

#include <stdexcept>

#include <algorithm>

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

TEST_CASE("EventKitStore refuses every write without access, and lists no reminders") {
  auto store = ngn::appkit::makeCalendarStore();
  using Failure = ngn::CalendarStore::Failure;
  ngn::CalendarStore::Details details;
  details.title = "Padel";
  details.start = 0;
  details.end = 3600000;
  if (store->access(Entity::Event) == Access::NotDetermined || store->access(Entity::Event) == Access::Denied ||
      store->access(Entity::Event) == Access::Restricted) {
    CHECK_THROWS_AS(store->createEvent("any", details), Failure);
    CHECK_THROWS_AS(store->updateEvent("any", details), Failure);
    CHECK_THROWS_AS(store->deleteEvent("any"), Failure);
  } else {
    MESSAGE("this test binary has calendar access; the denied event writes are not checked");
  }
  if (store->access(Entity::Reminder) == Access::FullAccess) {
    MESSAGE("this test binary has reminders access; the denied reminders are not checked");
    return;
  }
  CHECK_THROWS_AS(store->createReminder("any", details), Failure);
  CHECK_THROWS_AS(store->updateReminder("any", details), Failure);
  CHECK_THROWS_AS(store->deleteReminder("any"), Failure);
  CHECK_FALSE(store->reminder("any"));
  std::optional<size_t> listed;
  store->reminders({"any"}, std::nullopt, std::nullopt, std::nullopt, [&](auto found) { listed = found.size(); });
  REQUIRE(listed);
  CHECK(*listed == 0);

  // Through the module: rejected, naming the permission.
  auto module = ngn::makeCalendarModule(store, true);
  std::optional<std::string> refused;
  module->callWithPromise("createReminderAsync", folly::dynamic::array("any", folly::dynamic::object("title", "x")),
                          {.resolve = [](folly::dynamic) {}, .reject = [&](const std::string &m) { refused = m; }});
  REQUIRE(refused);
  CHECK(refused->find("remindersPermission") != std::string::npos);
}

TEST_CASE("an event's details write onto an EKEvent and read back in expo-calendar's terms") {
  EKEventStore *events = [[EKEventStore alloc] init];
  EKEvent *event = [EKEvent eventWithEventStore:events];
  ngn::CalendarStore::Details d;
  d.title = "Padel";
  d.location = "Club";
  d.notes = "Bring balls";
  d.url = "https://example.com/court";
  d.start = 1763112600000.0;
  d.end = 1763116200000.0;
  d.allDay = false;
  d.availability = "free";
  d.timeZone = "Europe/London";
  d.alarms = std::vector<ngn::CalendarStore::Alarm>{{.relativeOffset = -30}, {.absoluteDate = 1763100000000.0}};
  d.recurrence = ngn::CalendarStore::Recurrence{.frequency = "weekly", .interval = 2, .occurrence = 5};
  NGNApplyEventDetails(event, d);
  auto record = NGNEventRecord(event);
  CHECK(record.title == "Padel");
  CHECK(record.location == "Club");
  CHECK(record.notes == "Bring balls");
  CHECK(record.url == "https://example.com/court");
  CHECK(record.start == 1763112600000.0);
  CHECK(record.end == 1763116200000.0);
  // Availability reads notSupported until the event is in a calendar that keeps it.
  CHECK(record.timeZone == "Europe/London");
  // EventKit keeps alarms in an order of its own.
  using Alarm = ngn::CalendarStore::Alarm;
  REQUIRE(record.alarms.size() == 2);
  CHECK(std::count(record.alarms.begin(), record.alarms.end(), Alarm{.relativeOffset = -30}) == 1);
  CHECK(std::count(record.alarms.begin(), record.alarms.end(), Alarm{.absoluteDate = 1763100000000.0}) == 1);
  REQUIRE(record.recurrence);
  CHECK(record.recurrence->frequency == "weekly");
  CHECK(record.recurrence->interval == 2);
  CHECK(record.recurrence->occurrence == 5);

  // Fields to empty go, and the others stay.
  ngn::CalendarStore::Details clear;
  clear.cleared = {"location", "alarms", "recurrenceRule", "url"};
  NGNApplyEventDetails(event, clear);
  record = NGNEventRecord(event);
  CHECK_FALSE(record.location);
  CHECK_FALSE(record.url);
  CHECK(record.alarms.empty());
  CHECK_FALSE(record.recurrence);
  CHECK(record.title == "Padel");

  // A count of 0 is refused as a bad argument, not raised by EventKit.
  ngn::CalendarStore::Details never;
  never.recurrence = ngn::CalendarStore::Recurrence{.frequency = "daily", .occurrence = 0};
  CHECK_THROWS_AS(NGNApplyEventDetails(event, never), std::invalid_argument);
}

TEST_CASE("a reminder's details write onto an EKReminder: start, due and completion") {
  EKEventStore *events = [[EKEventStore alloc] init];
  EKReminder *reminder = [EKReminder reminderWithEventStore:events];
  ngn::CalendarStore::Details d;
  d.title = "Book court";
  d.timeZone = "UTC";
  d.start = 1763112600000.0;
  d.due = 1763199000000.0;
  d.completed = true;
  d.completionDate = 1763150000000.0;
  NGNApplyReminderDetails(reminder, d);
  auto record = NGNReminderRecord(reminder);
  CHECK(record.title == "Book court");
  CHECK(record.start == 1763112600000.0);
  CHECK(record.due == 1763199000000.0);
  CHECK_FALSE(record.allDay);
  CHECK(record.completed);
  CHECK(record.completionDate == 1763150000000.0);

  ngn::CalendarStore::Details clear;
  clear.cleared = {"dueDate", "startDate"};
  clear.completed = false;
  NGNApplyReminderDetails(reminder, clear);
  record = NGNReminderRecord(reminder);
  CHECK_FALSE(record.due);
  CHECK_FALSE(record.start);
  CHECK_FALSE(record.completed);
}

TEST_CASE("a reminder's allDay writes its due date as a whole day, given with the date or on its own") {
  EKEventStore *events = [[EKEventStore alloc] init];
  EKReminder *reminder = [EKReminder reminderWithEventStore:events];
  ngn::CalendarStore::Details d;
  d.timeZone = "UTC";
  d.due = 1763199000000.0; // 2025-11-15 09:30 UTC
  d.allDay = true;
  NGNApplyReminderDetails(reminder, d);
  auto record = NGNReminderRecord(reminder);
  CHECK(record.allDay);
  CHECK(record.due == 1763164800000.0); // that day's midnight

  // allDay on its own turns the due date there to a time of day and back.
  ngn::CalendarStore::Details timed;
  timed.allDay = false;
  NGNApplyReminderDetails(reminder, timed);
  CHECK_FALSE(NGNReminderRecord(reminder).allDay);

  ngn::CalendarStore::Details whole;
  whole.allDay = true;
  NGNApplyReminderDetails(reminder, whole);
  CHECK(NGNReminderRecord(reminder).allDay);

  // A new due date with allDay left out keeps the reminder's whole-day state.
  ngn::CalendarStore::Details moved;
  moved.due = 1763285400000.0;
  NGNApplyReminderDetails(reminder, moved);
  record = NGNReminderRecord(reminder);
  CHECK(record.allDay);
  CHECK(record.due == 1763251200000.0);
}
