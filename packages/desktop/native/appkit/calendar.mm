#include "calendar.h"

#import <AppKit/AppKit.h>
#import <EventKit/EventKit.h>

#include <mutex>

namespace ngn::appkit {

namespace {

using Access = CalendarStore::Access;
using Entity = CalendarStore::Entity;

EKEntityType entityTypeOf(Entity entity) {
  return entity == Entity::Event ? EKEntityTypeEvent : EKEntityTypeReminder;
}

Access accessOf(EKAuthorizationStatus status) {
  switch (static_cast<NSInteger>(status)) {
    case 1: return Access::Restricted;
    case 2: return Access::Denied;
    // EKAuthorizationStatusFullAccess, which is EKAuthorizationStatusAuthorized before macOS 14.
    case 3: return Access::FullAccess;
    // EKAuthorizationStatusWriteOnly (macOS 14).
    case 4: return Access::WriteOnly;
    default: return Access::NotDetermined;
  }
}

// Whether the app's Info.plist says why it asks: without the string the OS refuses the app, or
// ends it.
bool explains(Entity entity, bool writeOnly) {
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
  NSArray<NSString *> *keys = entity == Entity::Reminder ? @[ @"NSRemindersFullAccessUsageDescription", @"NSRemindersUsageDescription" ]
      : writeOnly ? @[ @"NSCalendarsWriteOnlyAccessUsageDescription", @"NSCalendarsFullAccessUsageDescription", @"NSCalendarsUsageDescription" ]
                  : @[ @"NSCalendarsFullAccessUsageDescription", @"NSCalendarsUsageDescription" ];
  for (NSString *key in keys) {
    if ([info[key] isKindOfClass:NSString.class] && [info[key] length] > 0) {
      return true;
    }
  }
  return false;
}

std::string text(NSString *value) {
  return value != nil ? std::string(value.UTF8String) : "";
}

double ms(NSDate *date) {
  return date != nil ? date.timeIntervalSince1970 * 1000 : 0;
}

std::string hexOf(NSColor *color) {
  NSColor *rgb = [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  if (rgb == nil) {
    return "";
  }
  auto channel = [](CGFloat value) { return static_cast<int>(std::lround(std::clamp<CGFloat>(value, 0, 1) * 255)); };
  char out[8];
  std::snprintf(out, sizeof out, "#%02X%02X%02X", channel(rgb.redComponent), channel(rgb.greenComponent), channel(rgb.blueComponent));
  return out;
}

CalendarStore::Source sourceOf(EKSource *source) {
  static const char *const kTypes[] = {"local", "exchange", "caldav", "mobileme", "subscribed", "birthdays"};
  auto type = static_cast<NSInteger>(source.sourceType);
  return {.id = text(source.sourceIdentifier), .name = text(source.title), .type = type >= 0 && type < 6 ? kTypes[type] : "local"};
}

CalendarStore::Calendar calendarOf(EKCalendar *calendar, EKCalendar *primary) {
  static const char *const kTypes[] = {"local", "caldav", "exchange", "subscription", "birthday"};
  auto type = static_cast<NSInteger>(calendar.type);
  return {
      .id = text(calendar.calendarIdentifier),
      .title = text(calendar.title),
      .source = sourceOf(calendar.source),
      .type = type >= 0 && type < 5 ? kTypes[type] : "local",
      .color = hexOf(calendar.color),
      .allowsModifications = static_cast<bool>(calendar.allowsContentModifications),
      .primary = primary != nil && [calendar.calendarIdentifier isEqualToString:primary.calendarIdentifier],
  };
}

CalendarStore::Event eventOf(EKEvent *event) {
  static const char *const kStatuses[] = {"none", "confirmed", "tentative", "canceled"};
  static const char *const kAvailabilities[] = {"busy", "free", "tentative", "unavailable"};
  auto status = static_cast<NSInteger>(event.status);
  auto availability = static_cast<NSInteger>(event.availability);
  return {
      .id = text(event.eventIdentifier),
      .calendarId = text(event.calendar.calendarIdentifier),
      .title = text(event.title),
      .location = event.location.length > 0 ? std::optional(text(event.location)) : std::nullopt,
      .notes = text(event.notes),
      .start = ms(event.startDate),
      .end = ms(event.endDate),
      .allDay = static_cast<bool>(event.allDay),
      .timeZone = text(event.timeZone.name),
      .url = event.URL != nil ? std::optional(text(event.URL.absoluteString)) : std::nullopt,
      .availability = availability >= 0 && availability < 4 ? kAvailabilities[availability] : "notSupported",
      .status = status >= 0 && status < 4 ? kStatuses[status] : "none",
  };
}

class EventKitStore final : public CalendarStore {
 public:
  Access access(Entity entity) override {
    return accessOf([EKEventStore authorizationStatusForEntityType:entityTypeOf(entity)]);
  }

  void requestAccess(Entity entity, bool writeOnly, std::function<void(Access)> done) override {
    if (!explains(entity, writeOnly)) {
      done(access(entity));
      return;
    }
    auto answer = std::make_shared<std::function<void(Access)>>(std::move(done));
    auto finish = ^(BOOL, NSError *) {
      (*answer)(access(entity));
    };
    EKEventStore *events = store();
    if (@available(macOS 14.0, *)) {
      if (entity == Entity::Reminder) {
        [events requestFullAccessToRemindersWithCompletion:finish];
      } else if (writeOnly) {
        [events requestWriteOnlyAccessToEventsWithCompletion:finish];
      } else {
        [events requestFullAccessToEventsWithCompletion:finish];
      }
    } else {
      [events requestAccessToEntityType:entityTypeOf(entity) completion:finish];
    }
  }

  std::vector<Calendar> calendars(Entity entity) override {
    std::vector<Calendar> out;
    if (access(entity) != Access::FullAccess) {
      return out;
    }
    EKEventStore *events = store();
    EKCalendar *primary = entity == Entity::Event ? events.defaultCalendarForNewEvents : events.defaultCalendarForNewReminders;
    for (EKCalendar *calendar in [events calendarsForEntityType:entityTypeOf(entity)]) {
      out.push_back(calendarOf(calendar, primary));
    }
    return out;
  }

  std::optional<Calendar> defaultCalendar() override {
    if (access(Entity::Event) != Access::FullAccess) {
      return std::nullopt;
    }
    EKCalendar *calendar = store().defaultCalendarForNewEvents;
    return calendar != nil ? std::optional(calendarOf(calendar, calendar)) : std::nullopt;
  }

  std::vector<Source> sources() override {
    std::vector<Source> out;
    if (access(Entity::Event) != Access::FullAccess && access(Entity::Reminder) != Access::FullAccess) {
      return out;
    }
    for (EKSource *source in store().sources) {
      out.push_back(sourceOf(source));
    }
    return out;
  }

  std::vector<Event> events(const std::vector<std::string> &calendarIds, double start, double end) override {
    std::vector<Event> out;
    if (access(Entity::Event) != Access::FullAccess) {
      return out;
    }
    EKEventStore *events = store();
    NSMutableArray<EKCalendar *> *calendars = [NSMutableArray array];
    for (const auto &id : calendarIds) {
      EKCalendar *calendar = [events calendarWithIdentifier:[NSString stringWithUTF8String:id.c_str()]];
      if (calendar != nil) {
        [calendars addObject:calendar];
      }
    }
    if (calendars.count == 0) {
      return out;
    }
    NSPredicate *predicate = [events predicateForEventsWithStartDate:[NSDate dateWithTimeIntervalSince1970:start / 1000]
                                                             endDate:[NSDate dateWithTimeIntervalSince1970:end / 1000]
                                                           calendars:calendars];
    for (EKEvent *event in [events eventsMatchingPredicate:predicate]) {
      out.push_back(eventOf(event));
    }
    return out;
  }

  std::optional<Event> event(const std::string &id) override {
    if (access(Entity::Event) != Access::FullAccess) {
      return std::nullopt;
    }
    EKEvent *event = [store() eventWithIdentifier:[NSString stringWithUTF8String:id.c_str()]];
    return event != nil ? std::optional(eventOf(event)) : std::nullopt;
  }

 private:
  // Made when first needed: to ask, or to read with access.
  EKEventStore *store() {
    std::lock_guard lock(mutex_);
    if (store_ == nil) {
      store_ = [[EKEventStore alloc] init];
    }
    return store_;
  }

  std::mutex mutex_;
  EKEventStore *store_{nil};
};

} // namespace

std::shared_ptr<CalendarStore> makeCalendarStore() {
  return std::make_shared<EventKitStore>();
}

} // namespace ngn::appkit
