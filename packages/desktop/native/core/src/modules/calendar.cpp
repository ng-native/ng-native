#include "ngn/calendar.h"

#include <cmath>
#include <cstdio>
#include <ctime>

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

folly::dynamic eventOf(const CalendarStore::Event &event) {
  return folly::dynamic::object("id", event.id)("calendarId", event.calendarId)("title", event.title)(
      "location", orNull(event.location))("notes", event.notes)("startDate", isoDate(event.start))(
      "endDate", isoDate(event.end))("allDay", event.allDay)("timeZone", event.timeZone)("url", orNull(event.url))(
      "alarms", folly::dynamic::array())("recurrenceRule", nullptr)("availability", event.availability)(
      "status", event.status);
}

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
    }
  };
  return std::make_shared<Calendar>(std::move(store), noPrompts);
}

} // namespace ngn
