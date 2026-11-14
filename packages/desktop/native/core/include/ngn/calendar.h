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
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <optional>
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
};

// Milliseconds since 1970 as ISO 8601 in UTC: "2026-11-14T09:30:00.000Z".
std::string isoDate(double ms);

std::shared_ptr<NativeModule> makeCalendarModule(std::shared_ptr<CalendarStore> store, bool noPrompts);

} // namespace ngn
