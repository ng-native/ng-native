#include "ngn/calendar.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <set>

namespace ngn {

namespace {

using Access = CalendarStore::Access;
using Entity = CalendarStore::Entity;

// Whether the access answers the ask: full access any ask, write-only access a write-only one.
bool grants(Access access, bool writeOnly) {
  return access == Access::FullAccess || (writeOnly && access == Access::WriteOnly);
}

// Whether an ask can still show the prompt: nothing decided yet, or write-only access that can
// still become full.
bool askable(Access access, bool writeOnly) {
  return access == Access::NotDetermined || (!writeOnly && access == Access::WriteOnly);
}

folly::dynamic permissionOf(Access access, bool writeOnly) {
  const char *status = grants(access, writeOnly) ? "granted" : askable(access, writeOnly) ? "undetermined" : "denied";
  return folly::dynamic::object("status", status)("granted", grants(access, writeOnly))(
      "canAskAgain", askable(access, writeOnly))("expires", "never");
}

folly::dynamic orNull(const std::optional<std::string> &value) {
  return value ? folly::dynamic(*value) : folly::dynamic(nullptr);
}

folly::dynamic sourceOf(const CalendarStore::Source &source) {
  return folly::dynamic::object("id", source.id)("name", source.name)("type", source.type)("isLocalAccount", source.type == "local");
}

folly::dynamic calendarOf(const CalendarStore::Calendar &calendar, Entity entity) {
  return folly::dynamic::object("id", calendar.id)("title", calendar.title)("sourceId", calendar.source.id)(
      "source", sourceOf(calendar.source))("type", calendar.type)("color", calendar.color)(
      "entityType", entity == Entity::Event ? "event" : "reminder")("allowsModifications", calendar.allowsModifications)(
      "allowedAvailabilities", folly::dynamic::array())("isPrimary", calendar.primary);
}

folly::dynamic dateOrNull(const std::optional<double> &ms) {
  return ms ? folly::dynamic(isoDate(*ms)) : folly::dynamic(nullptr);
}

folly::dynamic alarmsOf(const std::vector<CalendarStore::Alarm> &alarms) {
  folly::dynamic out = folly::dynamic::array();
  for (const auto &alarm : alarms) {
    folly::dynamic each = folly::dynamic::object();
    if (alarm.relativeOffset) {
      each["relativeOffset"] = *alarm.relativeOffset;
    }
    if (alarm.absoluteDate) {
      each["absoluteDate"] = isoDate(*alarm.absoluteDate);
    }
    out.push_back(std::move(each));
  }
  return out;
}

folly::dynamic recurrenceOf(const std::optional<CalendarStore::Recurrence> &rule) {
  if (!rule) {
    return nullptr;
  }
  folly::dynamic out = folly::dynamic::object("frequency", rule->frequency)("interval", rule->interval);
  if (rule->endDate) {
    out["endDate"] = isoDate(*rule->endDate);
  }
  if (rule->occurrence) {
    out["occurrence"] = *rule->occurrence;
  }
  return out;
}

folly::dynamic eventOf(const CalendarStore::Event &event) {
  return folly::dynamic::object("id", event.id)("calendarId", event.calendarId)("title", event.title)(
      "location", orNull(event.location))("notes", event.notes)("startDate", isoDate(event.start))(
      "endDate", isoDate(event.end))("allDay", event.allDay)("timeZone", event.timeZone)("url", orNull(event.url))(
      "alarms", alarmsOf(event.alarms))("recurrenceRule", recurrenceOf(event.recurrence))(
      "availability", event.availability)("status", event.status);
}

folly::dynamic reminderOf(const CalendarStore::Reminder &reminder) {
  return folly::dynamic::object("id", reminder.id)("calendarId", reminder.calendarId)("title", reminder.title)(
      "location", orNull(reminder.location))("notes", reminder.notes)("url", orNull(reminder.url))(
      "timeZone", reminder.timeZone)("startDate", dateOrNull(reminder.start))("dueDate", dateOrNull(reminder.due))(
      "allDay", reminder.allDay)("completed", reminder.completed)("completionDate", dateOrNull(reminder.completionDate))(
      "alarms", alarmsOf(reminder.alarms))("recurrenceRule", recurrenceOf(reminder.recurrence));
}

std::optional<double> numberArg(const folly::dynamic &args, size_t at) {
  return args.size() > at && args[at].isNumber() ? std::optional(args[at].asDouble()) : std::nullopt;
}

// Why a write was refused: the permission it needs, as the service names it.
constexpr const char *kNoEventWrite =
    "Calendar: no access to add events. Ask with Calendar.writePermission or Calendar.permission first.";
constexpr const char *kNoEventChange =
    "Calendar: no full access to the calendars, which changing or deleting an event needs. Ask with Calendar.permission first.";
constexpr const char *kNoReminders = "Calendar: no access to the reminders. Ask with Calendar.remindersPermission first.";
constexpr const char *kNoCalendarChange =
    "Calendar: no full access to the calendars, which creating or deleting a calendar needs. Ask with Calendar.permission first.";

Entity entityOf(const folly::dynamic &args) {
  return !args.empty() && args[0].isString() && args[0].asString() == "reminder" ? Entity::Reminder : Entity::Event;
}

bool flag(const folly::dynamic &args, size_t at) {
  return args.size() > at && args[at].isBool() && args[at].asBool();
}

std::optional<std::string> stringArg(const folly::dynamic &args, size_t at) {
  return args.size() > at && args[at].isString() ? std::optional(args[at].asString()) : std::nullopt;
}

} // namespace

CalendarStore::Details calendarDetails(const folly::dynamic &details, const folly::dynamic &nullable) {
  CalendarStore::Details out;
  auto wrong = [](const std::string &name, const char *type) {
    return std::invalid_argument("Calendar: " + name + " must be " + type);
  };
  if (nullable.isArray()) {
    for (const auto &name : nullable) {
      if (name.isString()) {
        out.cleared.insert(name.getString());
      }
    }
  }
  if (!details.isObject()) {
    return out;
  }
  for (const auto &[key, value] : details.items()) {
    if (!key.isString()) {
      continue;
    }
    const std::string name = key.getString();
    if (value.isNull()) {
      out.cleared.insert(name);
      continue;
    }
    auto text = [&](std::optional<std::string> &field) {
      if (!value.isString()) {
        throw wrong(name, "a string");
      }
      field = value.getString();
    };
    auto date = [&](std::optional<double> &field) {
      if (!value.isNumber()) {
        throw wrong(name, "a date");
      }
      field = value.asDouble();
    };
    auto boolean = [&](std::optional<bool> &field) {
      if (!value.isBool()) {
        throw wrong(name, "true or false");
      }
      field = value.getBool();
    };
    if (name == "title") {
      text(out.title);
    } else if (name == "location") {
      text(out.location);
    } else if (name == "notes") {
      text(out.notes);
    } else if (name == "url") {
      text(out.url);
    } else if (name == "timeZone") {
      text(out.timeZone);
    } else if (name == "availability") {
      text(out.availability);
    } else if (name == "startDate") {
      date(out.start);
    } else if (name == "endDate") {
      date(out.end);
    } else if (name == "dueDate") {
      date(out.due);
    } else if (name == "completionDate") {
      date(out.completionDate);
    } else if (name == "allDay") {
      boolean(out.allDay);
    } else if (name == "completed") {
      boolean(out.completed);
    } else if (name == "alarms") {
      if (!value.isArray()) {
        throw wrong(name, "a list");
      }
      out.alarms.emplace();
      for (const auto &alarm : value) {
        auto *offset = alarm.isObject() ? alarm.get_ptr("relativeOffset") : nullptr;
        auto *at = alarm.isObject() ? alarm.get_ptr("absoluteDate") : nullptr;
        if (offset != nullptr && offset->isNumber()) {
          out.alarms->push_back({.relativeOffset = offset->asDouble(), .absoluteDate = std::nullopt});
        } else if (at != nullptr && at->isNumber()) {
          out.alarms->push_back({.relativeOffset = std::nullopt, .absoluteDate = at->asDouble()});
        }
      }
    } else if (name == "recurrenceRule") {
      auto *frequency = value.isObject() ? value.get_ptr("frequency") : nullptr;
      static const std::set<std::string> kFrequencies{"daily", "weekly", "monthly", "yearly"};
      if (frequency == nullptr || !frequency->isString() || !kFrequencies.contains(frequency->getString())) {
        throw wrong(name, "a rule with a frequency of daily, weekly, monthly or yearly");
      }
      CalendarStore::Recurrence rule{.frequency = frequency->getString()};
      if (auto *interval = value.get_ptr("interval"); interval != nullptr && interval->isNumber()) {
        rule.interval = std::max(1, static_cast<int>(interval->asDouble()));
      }
      if (auto *end = value.get_ptr("endDate"); end != nullptr && end->isNumber()) {
        rule.endDate = end->asDouble();
      }
      if (auto *count = value.get_ptr("occurrence"); count != nullptr && count->isNumber()) {
        if (count->asDouble() < 1) {
          throw wrong(name, "a rule whose occurrence is 1 or more");
        }
        rule.occurrence = static_cast<int>(count->asDouble());
      }
      out.recurrence = rule;
    }
  }
  return out;
}

std::string isoDate(double ms) {
  auto seconds = static_cast<time_t>(std::floor(ms / 1000));
  auto millis = static_cast<int>(ms - static_cast<double>(seconds) * 1000);
  std::tm utc{};
  gmtime_r(&seconds, &utc);
  char out[32];
  std::snprintf(out, sizeof out, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday,
                utc.tm_hour, utc.tm_min, utc.tm_sec, millis);
  return out;
}

std::shared_ptr<NativeModule> makeCalendarModule(std::shared_ptr<CalendarStore> store, bool noPrompts) {
  struct Calendar : NativeModule {
    Calendar(std::shared_ptr<CalendarStore> store, bool noPrompts) : NativeModule("NgNativeCalendar") {
      auto get = [store](Entity entity, bool writeOnly) { return permissionOf(store->access(entity), writeOnly); };
      auto request = [store, noPrompts](Entity entity, bool writeOnly, JsPromise promise) {
        auto access = store->access(entity);
        if (noPrompts || !askable(access, writeOnly)) {
          promise.resolve(permissionOf(access, writeOnly));
          return;
        }
        store->requestAccess(entity, writeOnly, [promise, writeOnly](Access decided) { promise.resolve(permissionOf(decided, writeOnly)); });
      };
      promise("getCalendarPermissionsAsync", [get](const folly::dynamic &args, JsPromise promise) {
        promise.resolve(get(Entity::Event, flag(args, 0)));
      });
      promise("requestCalendarPermissionsAsync", [request](const folly::dynamic &args, JsPromise promise) {
        request(Entity::Event, flag(args, 0), std::move(promise));
      });
      promise("getRemindersPermissionsAsync", [get](const folly::dynamic &, JsPromise promise) {
        promise.resolve(get(Entity::Reminder, false));
      });
      promise("requestRemindersPermissionsAsync", [request](const folly::dynamic &, JsPromise promise) {
        request(Entity::Reminder, false, std::move(promise));
      });

      auto reads = [store](Entity entity) { return store->access(entity) == Access::FullAccess; };
      promise("getCalendarsAsync", [store, reads](const folly::dynamic &args, JsPromise promise) {
        auto entity = entityOf(args);
        folly::dynamic out = folly::dynamic::array();
        if (reads(entity)) {
          for (const auto &calendar : store->calendars(entity)) {
            out.push_back(calendarOf(calendar, entity));
          }
        }
        promise.resolve(std::move(out));
      });
      promise("getCalendarAsync", [store, reads](const folly::dynamic &args, JsPromise promise) {
        auto id = stringArg(args, 0);
        for (auto entity : {Entity::Event, Entity::Reminder}) {
          if (!id || !reads(entity)) {
            continue;
          }
          for (const auto &calendar : store->calendars(entity)) {
            if (calendar.id == *id) {
              promise.resolve(calendarOf(calendar, entity));
              return;
            }
          }
        }
        promise.resolve(nullptr);
      });
      sync("getDefaultCalendarSync", [store, reads](const folly::dynamic &) {
        auto calendar = reads(Entity::Event) ? store->defaultCalendar() : std::nullopt;
        return calendar ? calendarOf(*calendar, Entity::Event) : folly::dynamic(nullptr);
      });
      sync("getSourcesSync", [store, reads](const folly::dynamic &) {
        folly::dynamic out = folly::dynamic::array();
        if (reads(Entity::Event) || reads(Entity::Reminder)) {
          for (const auto &source : store->sources()) {
            out.push_back(sourceOf(source));
          }
        }
        return out;
      });
      promise("listEventsAsync", [store, reads](const folly::dynamic &args, JsPromise promise) {
        folly::dynamic out = folly::dynamic::array();
        if (args.size() < 3 || !args[0].isArray() || !args[1].isNumber() || !args[2].isNumber()) {
          promise.reject("Calendar.listEvents: takes calendar ids, a start and an end");
          return;
        }
        std::vector<std::string> ids;
        for (const auto &id : args[0]) {
          if (id.isString()) {
            ids.push_back(id.asString());
          }
        }
        if (reads(Entity::Event) && !ids.empty()) {
          for (const auto &event : store->events(ids, args[1].asDouble(), args[2].asDouble())) {
            out.push_back(eventOf(event));
          }
        }
        promise.resolve(std::move(out));
      });
      promise("getEventAsync", [store, reads](const folly::dynamic &args, JsPromise promise) {
        auto id = stringArg(args, 0);
        auto event = id && reads(Entity::Event) ? store->event(*id) : std::nullopt;
        promise.resolve(event ? eventOf(*event) : folly::dynamic(nullptr));
      });

      // A write: the item's id or calendar's id first, then the details and the fields to empty.
      // `allowed` says whether the access lets it run; `refused` why not.
      auto write = [](const char *method, bool allowed, const char *refused, const folly::dynamic &args, JsPromise &promise,
                      const std::function<folly::dynamic(const std::string &id, const CalendarStore::Details &)> &run) {
        if (!allowed) {
          promise.reject(refused);
          return;
        }
        auto id = stringArg(args, 0);
        if (!id) {
          promise.reject(std::string("Calendar.") + method + ": takes an id");
          return;
        }
        try {
          auto details = calendarDetails(args.size() > 1 ? args[1] : folly::dynamic(nullptr), args.size() > 2 ? args[2] : folly::dynamic(nullptr));
          promise.resolve(run(*id, details));
        } catch (const std::invalid_argument &e) {
          promise.reject(e.what());
        } catch (const CalendarStore::Failure &e) {
          promise.reject(e.what());
        }
      };
      auto writes = [store](Entity entity) {
        auto access = store->access(entity);
        return access == Access::FullAccess || (entity == Entity::Event && access == Access::WriteOnly);
      };
      promise("createEventAsync", [store, writes, write](const folly::dynamic &args, JsPromise promise) {
        write("createEvent", writes(Entity::Event), kNoEventWrite, args, promise, [&](const std::string &calendarId, const auto &details) {
          if (!details.start || !details.end) {
            throw std::invalid_argument("Calendar.createEvent: an event needs a startDate and an endDate");
          }
          if (*details.end < *details.start) {
            throw std::invalid_argument("Calendar.createEvent: the endDate is before the startDate");
          }
          return eventOf(store->createEvent(calendarId, details));
        });
      });
      promise("updateEventAsync", [store, reads, write](const folly::dynamic &args, JsPromise promise) {
        write("update", reads(Entity::Event), kNoEventChange, args, promise, [&](const std::string &id, const auto &details) {
          if (details.start && details.end && *details.end < *details.start) {
            throw std::invalid_argument("Calendar.update: the endDate is before the startDate");
          }
          return eventOf(store->updateEvent(id, details));
        });
      });
      promise("deleteEventAsync", [store, reads, write](const folly::dynamic &args, JsPromise promise) {
        write("delete", reads(Entity::Event), kNoEventChange, args, promise, [&](const std::string &id, const auto &) {
          store->deleteEvent(id);
          return folly::dynamic(nullptr);
        });
      });

      promise("createCalendarAsync", [store, reads](const folly::dynamic &args, JsPromise promise) {
        const folly::dynamic details = !args.empty() && args[0].isObject() ? args[0] : folly::dynamic::object();
        auto field = [&](const char *name) {
          const auto *value = details.get_ptr(name);
          return value != nullptr && value->isString() ? value->asString() : std::string();
        };
        auto entity = field("entityType") == "reminder" ? Entity::Reminder : Entity::Event;
        if (!reads(entity)) {
          promise.reject(entity == Entity::Event ? kNoCalendarChange : kNoReminders);
          return;
        }
        CalendarStore::NewCalendar calendar{.title = field("title"), .color = field("color"), .sourceId = field("sourceId")};
        if (calendar.title.empty()) {
          promise.reject("Calendar.createCalendar: a calendar needs a title");
          return;
        }
        try {
          promise.resolve(calendarOf(store->createCalendar(entity, calendar), entity));
        } catch (const CalendarStore::Failure &e) {
          promise.reject(e.what());
        }
      });
      promise("deleteCalendarAsync", [store, reads, write](const folly::dynamic &args, JsPromise promise) {
        bool allowed = reads(Entity::Event) || reads(Entity::Reminder);
        write("delete", allowed, kNoCalendarChange, args, promise, [&](const std::string &id, const auto &) {
          store->deleteCalendar(id);
          return folly::dynamic(nullptr);
        });
      });
      promise("listRemindersAsync", [store, reads](const folly::dynamic &args, JsPromise promise) {
        std::vector<std::string> ids;
        if (!args.empty() && args[0].isArray()) {
          for (const auto &id : args[0]) {
            if (id.isString()) {
              ids.push_back(id.asString());
            }
          }
        }
        if (!reads(Entity::Reminder) || ids.empty()) {
          promise.resolve(folly::dynamic::array());
          return;
        }
        store->reminders(ids, stringArg(args, 3), numberArg(args, 1), numberArg(args, 2), [promise](std::vector<CalendarStore::Reminder> found) {
          folly::dynamic out = folly::dynamic::array();
          for (const auto &reminder : found) {
            out.push_back(reminderOf(reminder));
          }
          promise.resolve(std::move(out));
        });
      });
      promise("getReminderAsync", [store, reads](const folly::dynamic &args, JsPromise promise) {
        auto id = stringArg(args, 0);
        auto reminder = id && reads(Entity::Reminder) ? store->reminder(*id) : std::nullopt;
        promise.resolve(reminder ? reminderOf(*reminder) : folly::dynamic(nullptr));
      });
      promise("createReminderAsync", [store, reads, write](const folly::dynamic &args, JsPromise promise) {
        write("createReminder", reads(Entity::Reminder), kNoReminders, args, promise, [&](const std::string &calendarId, const auto &details) {
          return reminderOf(store->createReminder(calendarId, details));
        });
      });
      promise("updateReminderAsync", [store, reads, write](const folly::dynamic &args, JsPromise promise) {
        write("update", reads(Entity::Reminder), kNoReminders, args, promise, [&](const std::string &id, const auto &details) {
          return reminderOf(store->updateReminder(id, details));
        });
      });
      promise("deleteReminderAsync", [store, reads, write](const folly::dynamic &args, JsPromise promise) {
        write("delete", reads(Entity::Reminder), kNoReminders, args, promise, [&](const std::string &id, const auto &) {
          store->deleteReminder(id);
          return folly::dynamic(nullptr);
        });
      });
    }
  };
  return std::make_shared<Calendar>(std::move(store), noPrompts);
}

} // namespace ngn
