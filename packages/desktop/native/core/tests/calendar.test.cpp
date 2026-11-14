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

  // The writes, each as its name and the item it named.
  std::vector<std::string> writes;
  Details lastDetails;
  // A message the next write fails with.
  std::optional<std::string> refuses;
  void write(const std::string &what, const std::string &id, const Details &details) {
    if (refuses) {
      throw Failure(*refuses);
    }
    writes.push_back(what + " " + id);
    lastDetails = details;
  }
  Event createEvent(const std::string &calendarId, const Details &details) override {
    write("createEvent", calendarId, details);
    return {.id = "new", .calendarId = calendarId, .title = details.title.value_or(""), .start = *details.start, .end = *details.end};
  }
  Event updateEvent(const std::string &id, const Details &details) override {
    write("updateEvent", id, details);
    return {.id = id, .calendarId = "c1", .title = details.title.value_or("Padel")};
  }
  void deleteEvent(const std::string &id) override { write("deleteEvent", id, {}); }

  std::vector<std::string> reminderAsks;
  void reminders(
      const std::vector<std::string> &ids,
      const std::optional<std::string> &status,
      std::optional<double> start,
      std::optional<double> end,
      std::function<void(std::vector<Reminder>)> done) override {
    reads++;
    reminderAsks.push_back(ids.at(0) + " " + status.value_or("any") + " " + (start ? std::to_string(static_cast<long>(*start)) : "-") +
                           " " + (end ? std::to_string(static_cast<long>(*end)) : "-"));
    done({{.id = "r9", .calendarId = ids.at(0), .title = "Buy balls", .due = 1763112600000.0, .alarms = {{.relativeOffset = -15}}}});
  }
  std::optional<Reminder> reminder(const std::string &id) override {
    reads++;
    if (id != "r9") {
      return std::nullopt;
    }
    return Reminder{.id = "r9", .calendarId = "r1", .title = "Buy balls", .completed = true, .completionDate = 0};
  }
  Reminder createReminder(const std::string &calendarId, const Details &details) override {
    write("createReminder", calendarId, details);
    return {.id = "r10", .calendarId = calendarId, .title = details.title.value_or("")};
  }
  Reminder updateReminder(const std::string &id, const Details &details) override {
    write("updateReminder", id, details);
    return {.id = id, .calendarId = "r1", .completed = details.completed.value_or(false)};
  }
  void deleteReminder(const std::string &id) override { write("deleteReminder", id, {}); }

  Calendar createCalendar(Entity entity, const NewCalendar &calendar) override {
    write(std::string("createCalendar ") + (entity == Entity::Event ? "event " : "reminder ") + calendar.title + " " + calendar.color + " " +
              calendar.sourceId,
          "", {});
    return {.id = "new-cal", .title = calendar.title, .source = home, .type = "caldav", .color = calendar.color, .allowsModifications = true};
  }
  void deleteCalendar(const std::string &id) override { write("deleteCalendar", id, {}); }
};

// A promise's rejection message, or nothing when it resolved.
std::optional<std::string> refusal(const ngn::NativeModule &module, const std::string &method, dynamic args) {
  std::optional<std::string> message;
  bool settled = false;
  module.callWithPromise(method, args, {.resolve = [&](dynamic) { settled = true; }, .reject = [&](const std::string &m) {
                                          settled = true;
                                          message = m;
                                        }});
  REQUIRE(settled);
  return message;
}

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

TEST_CASE("NgNativeCalendar creates an event with write-only or full access, from expo-calendar's details") {
  for (auto access : {Access::WriteOnly, Access::FullAccess}) {
    auto store = std::make_shared<FakeStore>();
    store->eventAccess = access;
    auto module = ngn::makeCalendarModule(store, false);
    dynamic details = dynamic::object("title", "Padel")("startDate", 1763112600000.0)("endDate", 1763116200000.0)(
        "location", "Club")("allDay", false)("alarms", dynamic::array(dynamic::object("relativeOffset", -30)))(
        "recurrenceRule", dynamic::object("frequency", "weekly")("interval", 2)("occurrence", 5))("availability", "busy");
    auto event = ask(*module, "createEventAsync", dynamic::array("c1", details));
    CHECK(event["id"] == dynamic("new"));
    CHECK(event["startDate"] == dynamic("2025-11-14T09:30:00.000Z"));
    CHECK(store->writes == std::vector<std::string>{"createEvent c1"});
    const auto &d = store->lastDetails;
    CHECK(d.title == "Padel");
    CHECK(d.location == "Club");
    CHECK(d.allDay == false);
    CHECK(d.availability == "busy");
    REQUIRE(d.alarms);
    CHECK(*d.alarms == std::vector<ngn::CalendarStore::Alarm>{{.relativeOffset = -30}});
    REQUIRE(d.recurrence);
    CHECK(d.recurrence->frequency == "weekly");
    CHECK(d.recurrence->interval == 2);
    CHECK(d.recurrence->occurrence == 5);
  }
}

TEST_CASE("NgNativeCalendar refuses event writes without access, saying which permission to ask for") {
  for (auto access : {Access::NotDetermined, Access::Denied, Access::Restricted}) {
    auto store = std::make_shared<FakeStore>();
    store->eventAccess = access;
    auto module = ngn::makeCalendarModule(store, false);
    dynamic details = dynamic::object("startDate", 0)("endDate", 1);
    auto refused = refusal(*module, "createEventAsync", dynamic::array("c1", details));
    REQUIRE(refused);
    CHECK(refused->find("writePermission") != std::string::npos);
    CHECK(refusal(*module, "updateEventAsync", dynamic::array("e1", details, dynamic::array())));
    CHECK(refusal(*module, "deleteEventAsync", dynamic::array("e1")));
    CHECK(store->writes.empty());
  }
  // Write-only access adds events and changes none: changing one needs reading it.
  auto store = std::make_shared<FakeStore>();
  store->eventAccess = Access::WriteOnly;
  auto module = ngn::makeCalendarModule(store, false);
  auto refused = refusal(*module, "updateEventAsync", dynamic::array("e1", dynamic::object("title", "x"), dynamic::array()));
  REQUIRE(refused);
  CHECK(refused->find("Calendar.permission") != std::string::npos);
  CHECK(refusal(*module, "deleteEventAsync", dynamic::array("e1")));
  CHECK(store->writes.empty());
}

TEST_CASE("NgNativeCalendar checks an event's dates and passes the OS's refusal on") {
  auto store = std::make_shared<FakeStore>();
  store->eventAccess = Access::FullAccess;
  auto module = ngn::makeCalendarModule(store, false);
  CHECK(refusal(*module, "createEventAsync", dynamic::array("c1", dynamic::object("title", "x")))->find("startDate") != std::string::npos);
  CHECK(refusal(*module, "createEventAsync", dynamic::array("c1", dynamic::object("startDate", 10)("endDate", 5))));
  CHECK(refusal(*module, "createEventAsync", dynamic::array("c1", dynamic::object("startDate", "today")("endDate", 5)))->find("startDate") !=
        std::string::npos);
  CHECK(refusal(*module, "createEventAsync", dynamic::array(3, dynamic::object("startDate", 0)("endDate", 5))));
  CHECK(store->writes.empty());
  store->refuses = "That calendar is read-only";
  CHECK(refusal(*module, "createEventAsync", dynamic::array("c1", dynamic::object("startDate", 0)("endDate", 5))) ==
        "That calendar is read-only");
}

TEST_CASE("NgNativeCalendar updates and deletes an event with full access, emptying the fields asked") {
  auto store = std::make_shared<FakeStore>();
  store->eventAccess = Access::FullAccess;
  auto module = ngn::makeCalendarModule(store, false);
  auto updated = ask(
      *module, "updateEventAsync", dynamic::array("e1", dynamic::object("title", "Tennis")("url", nullptr), dynamic::array("location")));
  CHECK(updated["title"] == dynamic("Tennis"));
  CHECK(store->lastDetails.title == "Tennis");
  CHECK_FALSE(store->lastDetails.url);
  CHECK(store->lastDetails.cleared == std::set<std::string>{"location", "url"});
  CHECK(ask(*module, "deleteEventAsync", dynamic::array("e1")) == dynamic(nullptr));
  CHECK(store->writes == std::vector<std::string>{"updateEvent e1", "deleteEvent e1"});
}

TEST_CASE("NgNativeCalendar lists, reads and writes reminders with full reminders access only") {
  auto store = std::make_shared<FakeStore>();
  store->eventAccess = Access::FullAccess;
  auto module = ngn::makeCalendarModule(store, false);
  // Event access says nothing of reminders.
  CHECK(ask(*module, "listRemindersAsync", dynamic::array(dynamic::array("r1"), nullptr, nullptr, nullptr)) == dynamic::array());
  CHECK(ask(*module, "getReminderAsync", dynamic::array("r9")) == dynamic(nullptr));
  auto refused = refusal(*module, "createReminderAsync", dynamic::array("r1", dynamic::object("title", "x")));
  REQUIRE(refused);
  CHECK(refused->find("remindersPermission") != std::string::npos);
  CHECK(refusal(*module, "updateReminderAsync", dynamic::array("r9", dynamic::object(), dynamic::array())));
  CHECK(refusal(*module, "deleteReminderAsync", dynamic::array("r9")));
  CHECK(store->reads == 0);
  CHECK(store->writes.empty());

  store->reminderAccess = Access::FullAccess;
  auto listed = ask(*module, "listRemindersAsync", dynamic::array(dynamic::array("r1"), 1000, 2000, "incomplete"));
  REQUIRE(listed.size() == 1);
  CHECK(listed[0]["id"] == dynamic("r9"));
  CHECK(listed[0]["dueDate"] == dynamic("2025-11-14T09:30:00.000Z"));
  CHECK(listed[0]["startDate"] == dynamic(nullptr));
  CHECK(listed[0]["completed"] == dynamic(false));
  CHECK(listed[0]["alarms"][0]["relativeOffset"] == dynamic(-15));
  CHECK(ask(*module, "listRemindersAsync", dynamic::array(dynamic::array("r1"))).size() == 1);
  CHECK(store->reminderAsks == std::vector<std::string>{"r1 incomplete 1000 2000", "r1 any - -"});
  CHECK(ask(*module, "getReminderAsync", dynamic::array("r9"))["completionDate"] == dynamic("1970-01-01T00:00:00.000Z"));
  CHECK(ask(*module, "getReminderAsync", dynamic::array("r0")) == dynamic(nullptr));

  auto created = ask(*module, "createReminderAsync", dynamic::array("r1", dynamic::object("title", "Book court")("dueDate", 5000)));
  CHECK(created["id"] == dynamic("r10"));
  CHECK(store->lastDetails.due == 5000);
  auto done = ask(*module, "updateReminderAsync", dynamic::array("r10", dynamic::object("completed", true), dynamic::array("dueDate")));
  CHECK(done["completed"] == dynamic(true));
  CHECK(store->lastDetails.cleared == std::set<std::string>{"dueDate"});
  CHECK(ask(*module, "deleteReminderAsync", dynamic::array("r10")) == dynamic(nullptr));
  CHECK(store->writes == std::vector<std::string>{"createReminder r1", "updateReminder r10", "deleteReminder r10"});
}

TEST_CASE("calendarDetails reads each field by its type, and names one of the wrong type") {
  auto d = ngn::calendarDetails(
      dynamic::object("title", "x")("notes", nullptr)("completed", true)("completionDate", 7)("timeZone", "UTC")(
          "alarms", dynamic::array(dynamic::object("absoluteDate", 99), dynamic::object("relativeOffset", "soon"))),
      dynamic::array("startDate", 3));
  CHECK(d.title == "x");
  CHECK(d.completed == true);
  CHECK(d.completionDate == 7);
  CHECK(d.timeZone == "UTC");
  CHECK(d.cleared == std::set<std::string>{"notes", "startDate"});
  REQUIRE(d.alarms);
  // An alarm with neither a number offset nor a date is no alarm.
  CHECK(*d.alarms == std::vector<ngn::CalendarStore::Alarm>{{.absoluteDate = 99}});
  CHECK_THROWS_WITH_AS(ngn::calendarDetails(dynamic::object("allDay", "yes"), dynamic::array()), doctest::Contains("allDay"), std::invalid_argument);
  CHECK_THROWS_AS(ngn::calendarDetails(dynamic::object("recurrenceRule", dynamic::object("frequency", "hourly")), dynamic::array()),
                  std::invalid_argument);
  // A recurrence rule given as null stops the repeating.
  CHECK(ngn::calendarDetails(dynamic::object("recurrenceRule", nullptr), dynamic::array()).cleared ==
        std::set<std::string>{"recurrenceRule"});
}

TEST_CASE("NgNativeCalendar creates a calendar or a reminder list with full access to its kind, and deletes one") {
  auto store = std::make_shared<FakeStore>();
  auto module = ngn::makeCalendarModule(store, false);
  dynamic details = dynamic::object("title", "Trips")("color", "#FF6600")("entityType", "event");
  CHECK(refusal(*module, "createCalendarAsync", dynamic::array(details)) ==
        "Calendar: no full access to the calendars, which creating or deleting a calendar needs. Ask with Calendar.permission first.");
  CHECK(refusal(*module, "deleteCalendarAsync", dynamic::array("c1")).has_value());
  store->eventAccess = Access::WriteOnly;
  CHECK(refusal(*module, "createCalendarAsync", dynamic::array(details)).has_value());
  CHECK(store->writes.empty());

  store->eventAccess = Access::FullAccess;
  auto created = ask(*module, "createCalendarAsync", dynamic::array(details));
  CHECK(created["id"] == dynamic("new-cal"));
  CHECK(created["title"] == dynamic("Trips"));
  CHECK(created["entityType"] == dynamic("event"));
  CHECK(store->writes.back() == "createCalendar event Trips #FF6600  ");
  // A reminder list needs the reminders, in the source asked for.
  dynamic list = dynamic::object("title", "Errands")("entityType", "reminder")("sourceId", "s2");
  CHECK(refusal(*module, "createCalendarAsync", dynamic::array(list)) == "Calendar: no access to the reminders. Ask with Calendar.remindersPermission first.");
  store->reminderAccess = Access::FullAccess;
  CHECK(ask(*module, "createCalendarAsync", dynamic::array(list))["entityType"] == dynamic("reminder"));
  CHECK(store->writes.back() == "createCalendar reminder Errands  s2 ");
  CHECK(refusal(*module, "createCalendarAsync", dynamic::array(dynamic(dynamic::object("color", "#000000")))) ==
        "Calendar.createCalendar: a calendar needs a title");

  CHECK(ask(*module, "deleteCalendarAsync", dynamic::array("new-cal")) == dynamic(nullptr));
  CHECK(store->writes.back() == "deleteCalendar new-cal");
  store->refuses = "Calendar: no calendar with the id gone";
  CHECK(refusal(*module, "deleteCalendarAsync", dynamic::array("gone")) == "Calendar: no calendar with the id gone");
}
