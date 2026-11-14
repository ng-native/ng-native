// NgNativeCalendar: what @ng-native/expo's Calendar calls on expo-calendar, over a CalendarStore,
// which the AppKit backend implements with EventKit.
//
// - getCalendarPermissionsAsync(writeOnly), requestCalendarPermissionsAsync(writeOnly),
//   getRemindersPermissionsAsync(), requestRemindersPermissionsAsync(): {status: granted | denied
//   | undetermined, granted, canAskAgain, expires: 'never'}. Write-only access grants a write-only
//   ask and leaves a full one undetermined, as it can still be asked for. Only what can still be
//   asked is asked; with `noPrompts` (NGN_NO_PROMPTS=1) nothing is, and the request answers what
//   is decided. The store asks only when the app's Info.plist explains why.
// - getCalendarsAsync(entityType), getCalendarAsync(id), getDefaultCalendarSync(),
//   getSourcesSync(), listEventsAsync(calendarIds, startMs, endMs), getEventAsync(id): records in
//   expo-calendar's shapes, dates as ISO 8601 strings. Without full access to the entity's
//   calendars they read nothing: [] or null, and the permission says why.
// - createEventAsync(calendarId, details), updateEventAsync(id, details, nullableFields),
//   deleteEventAsync(id): expo-calendar's ExpoCalendar.createEvent and an event's update() and
//   delete(), dates as milliseconds. Creating needs write-only or full access, changing and
//   deleting full access; without it they reject, saying which permission to ask for.
// - listRemindersAsync(calendarIds, start, end, status), getReminderAsync(id),
//   createReminderAsync(calendarId, details), updateReminderAsync(id, details, nullableFields),
//   deleteReminderAsync(id): the reminders, with full reminders access. Without it the reads
//   answer [] or null and the writes reject.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace ngn {

class CalendarStore {
 public:
  enum class Entity { Event, Reminder };
  enum class Access { NotDetermined, Denied, Restricted, FullAccess, WriteOnly };

  struct Source {
    std::string id;
    std::string name;
    // expo-calendar's SourceType: "local", "exchange", "caldav", "mobileme", "subscribed",
    // "birthdays".
    std::string type;
  };
  struct Calendar {
    std::string id;
    std::string title;
    Source source;
    // expo-calendar's CalendarType: "local", "caldav", "exchange", "subscription", "birthday".
    std::string type;
    // "#RRGGBB"
    std::string color;
    bool allowsModifications{false};
    bool primary{false};
  };
  // A reminder before the item, in minutes (negative before), or at a date in milliseconds.
  struct Alarm {
    std::optional<double> relativeOffset;
    std::optional<double> absoluteDate;
    bool operator==(const Alarm &) const = default;
  };
  // expo-calendar's RecurrenceRule: "daily", "weekly", "monthly" or "yearly", every `interval`,
  // until a date or for a count of occurrences.
  struct Recurrence {
    std::string frequency;
    int interval{1};
    std::optional<double> endDate;
    std::optional<int> occurrence;
    bool operator==(const Recurrence &) const = default;
  };
  struct Event {
    std::string id;
    std::string calendarId;
    std::string title;
    std::optional<std::string> location;
    std::string notes;
    // Milliseconds since 1970.
    double start{0};
    double end{0};
    bool allDay{false};
    std::string timeZone;
    std::optional<std::string> url;
    // expo-calendar's Availability and EventStatus names.
    std::string availability{"notSupported"};
    std::string status{"none"};
    std::vector<Alarm> alarms;
    std::optional<Recurrence> recurrence;
  };
  struct Reminder {
    std::string id;
    std::string calendarId;
    std::string title;
    std::optional<std::string> location;
    std::string notes;
    std::optional<std::string> url;
    std::string timeZone;
    // Milliseconds since 1970.
    std::optional<double> start;
    std::optional<double> due;
    bool allDay{false};
    bool completed{false};
    std::optional<double> completionDate;
    std::vector<Alarm> alarms;
    std::optional<Recurrence> recurrence;
  };
  // What a create or an update writes: each field that is set, and each of expo-calendar's field
  // names in `cleared` emptied.
  struct Details {
    std::optional<std::string> title, location, notes, url, timeZone, availability;
    std::optional<double> start, end, due, completionDate;
    std::optional<bool> allDay, completed;
    std::optional<std::vector<Alarm>> alarms;
    std::optional<Recurrence> recurrence;
    std::set<std::string> cleared;
  };
  // A write the OS refused, with its reason.
  struct Failure : std::runtime_error {
    using std::runtime_error::runtime_error;
  };

  virtual ~CalendarStore() = default;
  virtual Access access(Entity entity) = 0;
  // Shows the OS's prompt, and answers once the user has decided; answers the access as it is,
  // with no prompt, when the app gives no reason to ask. Any thread.
  virtual void requestAccess(Entity entity, bool writeOnly, std::function<void(Access)> done) = 0;
  // Read only with full access.
  virtual std::vector<Calendar> calendars(Entity entity) = 0;
  virtual std::optional<Calendar> defaultCalendar() = 0;
  virtual std::vector<Source> sources() = 0;
  virtual std::vector<Event> events(const std::vector<std::string> &calendarIds, double start, double end) = 0;
  virtual std::optional<Event> event(const std::string &id) = 0;

  // The writes. Each throws Failure when the OS refuses: no such calendar or item, a calendar
  // that takes no changes, or the save failing.
  virtual Event createEvent(const std::string &calendarId, const Details &details) = 0;
  virtual Event updateEvent(const std::string &id, const Details &details) = 0;
  virtual void deleteEvent(const std::string &id) = 0;

  // The reminders in the calendars: all of them for no status, else "incomplete" ones due in the
  // range or "completed" ones completed in it. Answers on any thread.
  virtual void reminders(
      const std::vector<std::string> &calendarIds,
      const std::optional<std::string> &status,
      std::optional<double> start,
      std::optional<double> end,
      std::function<void(std::vector<Reminder>)> done) = 0;
  virtual std::optional<Reminder> reminder(const std::string &id) = 0;
  virtual Reminder createReminder(const std::string &calendarId, const Details &details) = 0;
  virtual Reminder updateReminder(const std::string &id, const Details &details) = 0;
  virtual void deleteReminder(const std::string &id) = 0;
};

// The details of an expo-calendar create or update, dates as milliseconds, with the fields in
// `nullable` (and those given as null) to empty. Throws std::invalid_argument for a field of the
// wrong type, naming it.
CalendarStore::Details calendarDetails(const folly::dynamic &details, const folly::dynamic &nullable);

// Milliseconds since 1970 as ISO 8601 in UTC: "2026-11-14T09:30:00.000Z".
std::string isoDate(double ms);

std::shared_ptr<NativeModule> makeCalendarModule(std::shared_ptr<CalendarStore> store, bool noPrompts);

} // namespace ngn
