#include "calendar.h"

#import <AppKit/AppKit.h>
#import <EventKit/EventKit.h>

#include <mutex>

#include <stdexcept>

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

// "#RRGGBB" as a colour, or nil.
NSColor *colorOf(const std::string &hex) {
  unsigned value = 0;
  if (hex.size() != 7 || hex[0] != '#' || std::sscanf(hex.c_str() + 1, "%6x", &value) != 1) {
    return nil;
  }
  return [NSColor colorWithSRGBRed:((value >> 16) & 0xFF) / 255.0 green:((value >> 8) & 0xFF) / 255.0 blue:(value & 0xFF) / 255.0 alpha:1];
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

NSString *nsString(const std::string &value) {
  NSString *out = [NSString stringWithUTF8String:value.c_str()];
  return out != nil ? out : @"";
}

NSDate *dateOf(double ms) {
  return [NSDate dateWithTimeIntervalSince1970:ms / 1000];
}

std::vector<CalendarStore::Alarm> alarmsOf(NSArray<EKAlarm *> *alarms) {
  std::vector<CalendarStore::Alarm> out;
  for (EKAlarm *alarm in alarms) {
    if (alarm.absoluteDate != nil) {
      out.push_back({.relativeOffset = std::nullopt, .absoluteDate = ms(alarm.absoluteDate)});
    } else {
      out.push_back({.relativeOffset = alarm.relativeOffset / 60, .absoluteDate = std::nullopt});
    }
  }
  return out;
}

NSArray<EKAlarm *> *ekAlarms(const std::vector<CalendarStore::Alarm> &alarms) {
  NSMutableArray<EKAlarm *> *out = [NSMutableArray array];
  for (const auto &alarm : alarms) {
    [out addObject:alarm.absoluteDate ? [EKAlarm alarmWithAbsoluteDate:dateOf(*alarm.absoluteDate)]
                                      : [EKAlarm alarmWithRelativeOffset:alarm.relativeOffset.value_or(0) * 60]];
  }
  return out;
}

std::optional<CalendarStore::Recurrence> recurrenceOf(NSArray<EKRecurrenceRule *> *rules) {
  static const char *const kFrequencies[] = {"daily", "weekly", "monthly", "yearly"};
  EKRecurrenceRule *rule = rules.firstObject;
  if (rule == nil) {
    return std::nullopt;
  }
  auto frequency = static_cast<NSInteger>(rule.frequency);
  CalendarStore::Recurrence out{.frequency = frequency >= 0 && frequency < 4 ? kFrequencies[frequency] : "daily",
                                .interval = static_cast<int>(rule.interval)};
  if (rule.recurrenceEnd.endDate != nil) {
    out.endDate = ms(rule.recurrenceEnd.endDate);
  } else if (rule.recurrenceEnd.occurrenceCount > 0) {
    out.occurrence = static_cast<int>(rule.recurrenceEnd.occurrenceCount);
  }
  return out;
}

EKRecurrenceRule *ekRule(const CalendarStore::Recurrence &rule) {
  // EventKit throws an Objective-C exception for a count of 0.
  if (rule.occurrence && *rule.occurrence < 1) {
    throw std::invalid_argument("Calendar: a recurrenceRule's occurrence must be 1 or more");
  }
  EKRecurrenceFrequency frequency = rule.frequency == "weekly"    ? EKRecurrenceFrequencyWeekly
                                    : rule.frequency == "monthly" ? EKRecurrenceFrequencyMonthly
                                    : rule.frequency == "yearly"  ? EKRecurrenceFrequencyYearly
                                                                  : EKRecurrenceFrequencyDaily;
  EKRecurrenceEnd *end = rule.endDate      ? [EKRecurrenceEnd recurrenceEndWithEndDate:dateOf(*rule.endDate)]
                         : rule.occurrence ? [EKRecurrenceEnd recurrenceEndWithOccurrenceCount:static_cast<NSUInteger>(*rule.occurrence)]
                                           : nil;
  return [[EKRecurrenceRule alloc] initRecurrenceWithFrequency:frequency interval:std::max(1, rule.interval) end:end];
}

// What events and reminders share: their text, time zone, alarms and recurrence.
void applyItem(EKCalendarItem *item, const CalendarStore::Details &d) {
  auto cleared = [&](const char *name) { return d.cleared.contains(name); };
  if (d.title) {
    item.title = nsString(*d.title);
  } else if (cleared("title")) {
    item.title = @"";
  }
  if (d.location) {
    item.location = nsString(*d.location);
  } else if (cleared("location")) {
    item.location = nil;
  }
  if (d.notes) {
    item.notes = nsString(*d.notes);
  } else if (cleared("notes")) {
    item.notes = nil;
  }
  if (d.url) {
    item.URL = [NSURL URLWithString:nsString(*d.url)];
  } else if (cleared("url")) {
    item.URL = nil;
  }
  if (d.timeZone) {
    item.timeZone = [NSTimeZone timeZoneWithName:nsString(*d.timeZone)];
  } else if (cleared("timeZone")) {
    item.timeZone = nil;
  }
  if (d.alarms) {
    item.alarms = ekAlarms(*d.alarms);
  } else if (cleared("alarms")) {
    item.alarms = nil;
  }
  if (d.recurrence) {
    item.recurrenceRules = @[ ekRule(*d.recurrence) ];
  } else if (cleared("recurrenceRule")) {
    item.recurrenceRules = nil;
  }
}

// A whole day's components have no time of day, which is how a reminder reads as all day.
NSDateComponents *componentsOf(double ms, NSTimeZone *zone, bool wholeDay = false) {
  NSCalendar *calendar = [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];
  calendar.timeZone = zone != nil ? zone : NSTimeZone.defaultTimeZone;
  NSCalendarUnit units = NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay | NSCalendarUnitTimeZone;
  if (!wholeDay) {
    units |= NSCalendarUnitHour | NSCalendarUnitMinute | NSCalendarUnitSecond;
  }
  NSDateComponents *out = [calendar components:units fromDate:dateOf(ms)];
  out.calendar = calendar;
  return out;
}

std::optional<double> msOf(NSDateComponents *components) {
  if (components == nil) {
    return std::nullopt;
  }
  NSCalendar *calendar = components.calendar != nil ? components.calendar : [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];
  NSDate *date = [calendar dateFromComponents:components];
  return date != nil ? std::optional(ms(date)) : std::nullopt;
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
      .alarms = alarmsOf(event.alarms),
      .recurrence = recurrenceOf(event.recurrenceRules),
  };
}

void applyEvent(EKEvent *event, const CalendarStore::Details &d) {
  applyItem(event, d);
  if (d.start) {
    event.startDate = dateOf(*d.start);
  }
  if (d.end) {
    event.endDate = dateOf(*d.end);
  }
  if (d.allDay) {
    event.allDay = *d.allDay;
  }
  if (d.availability) {
    static const std::pair<const char *, EKEventAvailability> kAvailabilities[] = {
        {"busy", EKEventAvailabilityBusy},
        {"free", EKEventAvailabilityFree},
        {"tentative", EKEventAvailabilityTentative},
        {"unavailable", EKEventAvailabilityUnavailable},
    };
    for (const auto &[name, value] : kAvailabilities) {
      if (*d.availability == name) {
        event.availability = value;
      }
    }
  }
}

CalendarStore::Reminder reminderOf(EKReminder *reminder) {
  NSDateComponents *due = reminder.dueDateComponents;
  return {
      .id = text(reminder.calendarItemIdentifier),
      .calendarId = text(reminder.calendar.calendarIdentifier),
      .title = text(reminder.title),
      .location = reminder.location.length > 0 ? std::optional(text(reminder.location)) : std::nullopt,
      .notes = text(reminder.notes),
      .url = reminder.URL != nil ? std::optional(text(reminder.URL.absoluteString)) : std::nullopt,
      .timeZone = text(reminder.timeZone.name),
      .start = msOf(reminder.startDateComponents),
      .due = msOf(due),
      // A due date with no time of day is a whole day's.
      .allDay = due != nil && due.hour == NSDateComponentUndefined,
      .completed = static_cast<bool>(reminder.completed),
      .completionDate = reminder.completionDate != nil ? std::optional(ms(reminder.completionDate)) : std::nullopt,
      .alarms = alarmsOf(reminder.alarms),
      .recurrence = recurrenceOf(reminder.recurrenceRules),
  };
}

void applyReminder(EKReminder *reminder, const CalendarStore::Details &d) {
  applyItem(reminder, d);
  if (d.start) {
    reminder.startDateComponents = componentsOf(*d.start, reminder.timeZone);
  } else if (d.cleared.contains("startDate")) {
    reminder.startDateComponents = nil;
  }
  // allDay applies to the due date given, or to the one there; left out, the reminder's stays.
  NSDateComponents *current = reminder.dueDateComponents;
  bool wholeDay = d.allDay ? *d.allDay : current != nil && current.hour == NSDateComponentUndefined;
  if (d.due) {
    reminder.dueDateComponents = componentsOf(*d.due, reminder.timeZone, wholeDay);
  } else if (d.allDay && current != nil && !d.cleared.contains("dueDate")) {
    reminder.dueDateComponents = componentsOf(*msOf(current), reminder.timeZone, wholeDay);
  } else if (d.cleared.contains("dueDate")) {
    reminder.dueDateComponents = nil;
  }
  if (d.completed) {
    reminder.completed = *d.completed;
  }
  if (d.completionDate) {
    reminder.completionDate = dateOf(*d.completionDate);
  } else if (d.cleared.contains("completionDate")) {
    reminder.completionDate = nil;
  }
}

NSString *idOf(const std::string &id) {
  return nsString(id);
}

// The class's own answer, so a completion that outlives the store reads no freed store.
CalendarStore::Access accessNow(CalendarStore::Entity entity) {
  return accessOf([EKEventStore authorizationStatusForEntityType:entityTypeOf(entity)]);
}

class EventKitStore final : public CalendarStore {
 public:
  Access access(Entity entity) override {
    return accessNow(entity);
  }

  void requestAccess(Entity entity, bool writeOnly, std::function<void(Access)> done) override {
    if (!explains(entity, writeOnly)) {
      done(access(entity));
      return;
    }
    auto answer = std::make_shared<std::function<void(Access)>>(std::move(done));
    auto finish = ^(BOOL, NSError *) {
      (*answer)(accessNow(entity));
    };
    EKEventStore *events = store();
    if (entity == Entity::Reminder) {
      [events requestFullAccessToRemindersWithCompletion:finish];
    } else if (writeOnly) {
      [events requestWriteOnlyAccessToEventsWithCompletion:finish];
    } else {
      [events requestFullAccessToEventsWithCompletion:finish];
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

  Event createEvent(const std::string &calendarId, const Details &details) override {
    auto granted = access(Entity::Event);
    if (granted != Access::FullAccess && granted != Access::WriteOnly) {
      throw Failure("Calendar: no access to add events");
    }
    EKEventStore *events = store();
    EKCalendar *calendar = [events calendarWithIdentifier:idOf(calendarId)];
    // Write-only access sees no calendars: the event goes in the default one, as on iOS.
    if (calendar == nil && granted == Access::WriteOnly) {
      calendar = events.defaultCalendarForNewEvents;
    }
    writable(calendar, calendarId);
    EKEvent *event = [EKEvent eventWithEventStore:events];
    event.calendar = calendar;
    applyEvent(event, details);
    NSError *error = nil;
    if (![events saveEvent:event span:EKSpanThisEvent commit:YES error:&error]) {
      throw Failure(failure("Calendar.createEvent", error));
    }
    return eventOf(event);
  }

  Event updateEvent(const std::string &id, const Details &details) override {
    EKEventStore *events = store();
    EKEvent *event = existingEvent(id);
    applyEvent(event, details);
    NSError *error = nil;
    if (![events saveEvent:event span:EKSpanThisEvent commit:YES error:&error]) {
      throw Failure(failure("Calendar.update", error));
    }
    return eventOf(event);
  }

  Calendar createCalendar(Entity entity, const NewCalendar &asked) override {
    if (access(entity) != Access::FullAccess) {
      throw Failure(entity == Entity::Event ? "Calendar: no full access to the calendars" : "Calendar: no access to the reminders");
    }
    EKEventStore *events = store();
    EKSource *source = nil;
    for (EKSource *each in events.sources) {
      if (!asked.sourceId.empty() && [each.sourceIdentifier isEqualToString:idOf(asked.sourceId)]) {
        source = each;
      }
    }
    if (source == nil && !asked.sourceId.empty()) {
      throw Failure("Calendar: no source with the id " + asked.sourceId);
    }
    if (source == nil) {
      EKCalendar *fallback = entity == Entity::Event ? events.defaultCalendarForNewEvents : events.defaultCalendarForNewReminders;
      source = fallback.source;
    }
    EKCalendar *calendar = [EKCalendar calendarForEntityType:entityTypeOf(entity) eventStore:events];
    calendar.title = nsString(asked.title);
    calendar.source = source;
    if (NSColor *color = colorOf(asked.color)) {
      calendar.color = color;
    }
    NSError *error = nil;
    if (![events saveCalendar:calendar commit:YES error:&error]) {
      throw Failure(failure("Calendar.createCalendar", error));
    }
    EKCalendar *primary = entity == Entity::Event ? events.defaultCalendarForNewEvents : events.defaultCalendarForNewReminders;
    return calendarOf(calendar, primary);
  }

  void deleteCalendar(const std::string &id) override {
    EKEventStore *events = store();
    EKCalendar *calendar = [events calendarWithIdentifier:idOf(id)];
    if (calendar == nil) {
      throw Failure("Calendar: no calendar with the id " + id);
    }
    if (access(calendar.allowedEntityTypes & EKEntityMaskReminder ? Entity::Reminder : Entity::Event) != Access::FullAccess) {
      throw Failure("Calendar: no full access to the calendar " + id);
    }
    NSError *error = nil;
    if (![events removeCalendar:calendar commit:YES error:&error]) {
      throw Failure(failure("Calendar.delete", error));
    }
  }

  void deleteEvent(const std::string &id) override {
    EKEventStore *events = store();
    EKEvent *event = existingEvent(id);
    NSError *error = nil;
    if (![events removeEvent:event span:EKSpanThisEvent commit:YES error:&error]) {
      throw Failure(failure("Calendar.delete", error));
    }
  }

  void reminders(
      const std::vector<std::string> &calendarIds,
      const std::optional<std::string> &status,
      std::optional<double> start,
      std::optional<double> end,
      std::function<void(std::vector<Reminder>)> done) override {
    if (access(Entity::Reminder) != Access::FullAccess) {
      done({});
      return;
    }
    EKEventStore *events = store();
    NSMutableArray<EKCalendar *> *calendars = [NSMutableArray array];
    for (const auto &id : calendarIds) {
      if (EKCalendar *calendar = [events calendarWithIdentifier:idOf(id)]) {
        [calendars addObject:calendar];
      }
    }
    if (calendars.count == 0) {
      done({});
      return;
    }
    NSDate *from = start ? dateOf(*start) : nil;
    NSDate *to = end ? dateOf(*end) : nil;
    NSPredicate *predicate = status == "incomplete"
                                 ? [events predicateForIncompleteRemindersWithDueDateStarting:from ending:to calendars:calendars]
                             : status == "completed"
                                 ? [events predicateForCompletedRemindersWithCompletionDateStarting:from ending:to calendars:calendars]
                                 : [events predicateForRemindersInCalendars:calendars];
    auto answer = std::make_shared<std::function<void(std::vector<Reminder>)>>(std::move(done));
    [events fetchRemindersMatchingPredicate:predicate
                                 completion:^(NSArray<EKReminder *> *found) {
                                   std::vector<Reminder> out;
                                   for (EKReminder *reminder in found) {
                                     out.push_back(reminderOf(reminder));
                                   }
                                   (*answer)(std::move(out));
                                 }];
  }

  std::optional<Reminder> reminder(const std::string &id) override {
    if (access(Entity::Reminder) != Access::FullAccess) {
      return std::nullopt;
    }
    EKCalendarItem *item = [store() calendarItemWithIdentifier:idOf(id)];
    return [item isKindOfClass:EKReminder.class] ? std::optional(reminderOf((EKReminder *)item)) : std::nullopt;
  }

  Reminder createReminder(const std::string &calendarId, const Details &details) override {
    if (access(Entity::Reminder) != Access::FullAccess) {
      throw Failure("Calendar: no access to the reminders");
    }
    EKEventStore *events = store();
    EKCalendar *calendar = [events calendarWithIdentifier:idOf(calendarId)];
    writable(calendar, calendarId);
    EKReminder *reminder = [EKReminder reminderWithEventStore:events];
    reminder.calendar = calendar;
    applyReminder(reminder, details);
    NSError *error = nil;
    if (![events saveReminder:reminder commit:YES error:&error]) {
      throw Failure(failure("Calendar.createReminder", error));
    }
    return reminderOf(reminder);
  }

  Reminder updateReminder(const std::string &id, const Details &details) override {
    EKEventStore *events = store();
    EKReminder *reminder = existingReminder(id);
    applyReminder(reminder, details);
    NSError *error = nil;
    if (![events saveReminder:reminder commit:YES error:&error]) {
      throw Failure(failure("Calendar.update", error));
    }
    return reminderOf(reminder);
  }

  void deleteReminder(const std::string &id) override {
    EKEventStore *events = store();
    EKReminder *reminder = existingReminder(id);
    NSError *error = nil;
    if (![events removeReminder:reminder commit:YES error:&error]) {
      throw Failure(failure("Calendar.delete", error));
    }
  }

 private:
  static std::string failure(const char *what, NSError *error) {
    return std::string(what) + ": " + (error != nil ? text(error.localizedDescription) : "the save failed");
  }

  static void writable(EKCalendar *calendar, const std::string &id) {
    if (calendar == nil) {
      throw Failure("Calendar: no calendar with the id " + id);
    }
    if (!calendar.allowsContentModifications) {
      throw Failure("Calendar: the calendar " + text(calendar.title) + " takes no changes");
    }
  }

  EKEvent *existingEvent(const std::string &id) {
    if (access(Entity::Event) != Access::FullAccess) {
      throw Failure("Calendar: no full access to the calendars");
    }
    EKEvent *event = [store() eventWithIdentifier:idOf(id)];
    if (event == nil) {
      throw Failure("Calendar: no event with the id " + id);
    }
    return event;
  }

  EKReminder *existingReminder(const std::string &id) {
    if (access(Entity::Reminder) != Access::FullAccess) {
      throw Failure("Calendar: no access to the reminders");
    }
    EKCalendarItem *item = [store() calendarItemWithIdentifier:idOf(id)];
    if (![item isKindOfClass:EKReminder.class]) {
      throw Failure("Calendar: no reminder with the id " + id);
    }
    return (EKReminder *)item;
  }

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

void NGNApplyEventDetails(EKEvent *event, const ngn::CalendarStore::Details &details) {
  ngn::appkit::applyEvent(event, details);
}

void NGNApplyReminderDetails(EKReminder *reminder, const ngn::CalendarStore::Details &details) {
  ngn::appkit::applyReminder(reminder, details);
}

ngn::CalendarStore::Event NGNEventRecord(EKEvent *event) {
  return ngn::appkit::eventOf(event);
}

ngn::CalendarStore::Reminder NGNReminderRecord(EKReminder *reminder) {
  return ngn::appkit::reminderOf(reminder);
}
