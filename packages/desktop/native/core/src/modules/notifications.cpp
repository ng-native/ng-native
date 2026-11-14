#include "ngn/notifications.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>

namespace ngn {

namespace {

const char *const kDefaultAction = "expo.modules.notifications.actions.DEFAULT";

std::optional<double> number(const folly::dynamic &object, const char *key) {
  auto value = object.get_ptr(key);
  if (value == nullptr || !value->isNumber()) {
    return std::nullopt;
  }
  return value->asDouble();
}

std::string string(const folly::dynamic &object, const char *key) {
  auto value = object.get_ptr(key);
  return value != nullptr && value->isString() ? value->asString() : std::string{};
}

bool whole(double value, double low, double high) {
  return std::floor(value) == value && value >= low && value <= high;
}

// Components Expo names, with their ranges as NSDateComponents takes them (after the shifts).
struct Component {
  const char *name;
  double low;
  double high;
};
const Component kComponents[] = {
    {"year", 1, 9999}, {"month", 1, 12}, {"day", 1, 31}, {"weekday", 1, 7},
    {"hour", 0, 23},   {"minute", 0, 59}, {"second", 0, 59},
};

// The named components of `trigger`, required ones first; `monthFromZero` reads `month` as Expo's
// yearly trigger does (0 is January).
std::optional<std::string> readComponents(
    const folly::dynamic &trigger,
    const std::vector<std::string> &required,
    bool monthFromZero,
    NotificationTrigger &out) {
  for (const auto &component : kComponents) {
    auto value = number(trigger, component.name);
    bool needed = std::find(required.begin(), required.end(), component.name) != required.end();
    if (!value) {
      if (needed) {
        return std::string("the trigger needs ") + component.name;
      }
      continue;
    }
    double v = *value + (monthFromZero && std::string_view(component.name) == "month" ? 1 : 0);
    if (!whole(v, component.low, component.high)) {
      return std::string("the trigger's ") + component.name + " is out of range";
    }
    out.components[component.name] = static_cast<int>(v);
  }
  return std::nullopt;
}

folly::dynamic contentJson(const NotificationRequest &request) {
  return folly::dynamic::object("title", request.title.empty() ? folly::dynamic(nullptr) : folly::dynamic(request.title))(
      "subtitle", request.subtitle.empty() ? folly::dynamic(nullptr) : folly::dynamic(request.subtitle))(
      "body", request.body.empty() ? folly::dynamic(nullptr) : folly::dynamic(request.body))("data", request.data)(
      "sound", request.sound.empty() ? folly::dynamic(nullptr) : folly::dynamic(request.sound))(
      "badge", request.badge ? folly::dynamic(*request.badge) : folly::dynamic(nullptr));
}

folly::dynamic notificationJson(double date, const NotificationRequest &request) {
  return folly::dynamic::object("date", date)("request", notificationRequestJson(request));
}

} // namespace

std::variant<NotificationTrigger, std::string> parseNotificationTrigger(const folly::dynamic &trigger) {
  NotificationTrigger out;
  if (trigger.isNull()) {
    return out;
  }
  if (trigger.isNumber()) {
    out.kind = NotificationTrigger::Kind::Date;
    out.date = trigger.asDouble();
    return out;
  }
  if (!trigger.isObject()) {
    return std::string("the trigger must be null, a date or an object");
  }
  auto type = string(trigger, "type");
  bool repeats = trigger.getDefault("repeats", false) == true;
  if (type == "timeInterval" || (type.empty() && number(trigger, "seconds"))) {
    auto seconds = number(trigger, "seconds");
    if (!seconds || *seconds <= 0) {
      return std::string("a time interval trigger needs seconds above 0");
    }
    // The OS refuses a repeating interval under a minute.
    if (repeats && *seconds < 60) {
      return std::string("a repeating time interval must be at least 60 seconds");
    }
    out.kind = NotificationTrigger::Kind::Interval;
    out.seconds = *seconds;
    out.repeats = repeats;
    return out;
  }
  if (type == "date") {
    auto date = number(trigger, "date");
    if (!date) {
      return std::string("a date trigger needs its date in milliseconds since the epoch");
    }
    out.kind = NotificationTrigger::Kind::Date;
    out.date = *date;
    return out;
  }
  out.kind = NotificationTrigger::Kind::Calendar;
  std::optional<std::string> problem;
  if (type == "daily") {
    out.repeats = true;
    problem = readComponents(trigger, {"hour", "minute"}, false, out);
  } else if (type == "weekly") {
    out.repeats = true;
    problem = readComponents(trigger, {"weekday", "hour", "minute"}, false, out);
  } else if (type == "monthly") {
    out.repeats = true;
    problem = readComponents(trigger, {"day", "hour", "minute"}, false, out);
  } else if (type == "yearly") {
    out.repeats = true;
    problem = readComponents(trigger, {"month", "day", "hour", "minute"}, true, out);
  } else if (type == "calendar") {
    out.repeats = repeats;
    problem = readComponents(trigger, {}, false, out);
    if (!problem && out.components.empty()) {
      problem = "a calendar trigger needs at least one date component";
    }
  } else {
    return "the trigger type " + (type.empty() ? std::string("(none)") : type) + " is not one the desktop knows";
  }
  if (problem) {
    return *problem;
  }
  // Only the components a trigger type names: a daily trigger never pins a weekday.
  return out;
}

std::variant<NotificationRequest, std::string> parseNotificationRequest(const folly::dynamic &request) {
  if (!request.isObject()) {
    return std::string("the request must be an object");
  }
  NotificationRequest out;
  out.identifier = string(request, "identifier");
  auto content = request.get_ptr("content");
  if (content == nullptr || !content->isObject()) {
    return std::string("the request needs content");
  }
  out.title = string(*content, "title");
  out.subtitle = string(*content, "subtitle");
  out.body = string(*content, "body");
  if (auto data = content->get_ptr("data"); data != nullptr && data->isObject()) {
    out.data = *data;
  }
  if (auto sound = content->get_ptr("sound"); sound != nullptr) {
    if (sound->isBool()) {
      out.sound = sound->asBool() ? "default" : "";
    } else if (sound->isString()) {
      out.sound = sound->asString();
    }
  }
  if (auto badge = number(*content, "badge")) {
    if (!whole(*badge, 0, 1e9)) {
      return std::string("the badge must be a whole number from 0");
    }
    out.badge = static_cast<int>(*badge);
  }
  auto trigger = parseNotificationTrigger(request.getDefault("trigger", nullptr));
  if (auto *problem = std::get_if<std::string>(&trigger)) {
    return *problem;
  }
  out.trigger = std::get<NotificationTrigger>(trigger);
  return out;
}

folly::dynamic notificationRequestJson(const NotificationRequest &request) {
  folly::dynamic trigger = nullptr;
  switch (request.trigger.kind) {
    case NotificationTrigger::Kind::Now:
      break;
    case NotificationTrigger::Kind::Interval:
      trigger = folly::dynamic(folly::dynamic::object("type", "timeInterval")("seconds", request.trigger.seconds)(
          "repeats", request.trigger.repeats));
      break;
    case NotificationTrigger::Kind::Date:
      trigger = folly::dynamic(folly::dynamic::object("type", "date")("value", request.trigger.date)("repeats", false));
      break;
    case NotificationTrigger::Kind::Calendar: {
      folly::dynamic components = folly::dynamic::object();
      for (const auto &[name, value] : request.trigger.components) {
        components[name] = value;
      }
      trigger = folly::dynamic(folly::dynamic::object("type", "calendar")("repeats", request.trigger.repeats)(
          "dateComponents", std::move(components)));
      break;
    }
  }
  return folly::dynamic::object("identifier", request.identifier)("content", contentJson(request))(
      "trigger", std::move(trigger));
}

std::string badgeLabel(int count) {
  return count > 0 ? std::to_string(count) : std::string{};
}

folly::dynamic permissionResponse(NotificationAuthorization authorization, bool canPost) {
  std::string status = !canPost                                                  ? "denied"
      : authorization == NotificationAuthorization::Authorized                   ? "granted"
      : authorization == NotificationAuthorization::Denied                       ? "denied"
                                                                                 : "undetermined";
  return folly::dynamic::object("status", status)("granted", status == "granted")(
      "canAskAgain", canPost && authorization == NotificationAuthorization::NotDetermined)("expires", "never");
}

void NotificationEvents::received(double date, const NotificationRequest &request) {
  send(folly::dynamic::object("type", "received")("notification", notificationJson(date, request)));
}

void NotificationEvents::responded(double date, const NotificationRequest &request) {
  folly::dynamic response =
      folly::dynamic::object("actionIdentifier", kDefaultAction)("notification", notificationJson(date, request));
  {
    std::lock_guard lock(mutex_);
    lastResponse_ = response;
  }
  send(folly::dynamic::object("type", "response")("response", response));
}

std::optional<folly::dynamic> NotificationEvents::lastResponse() const {
  std::lock_guard lock(mutex_);
  return lastResponse_;
}

std::shared_ptr<void> NotificationEvents::listen(std::function<void(const folly::dynamic &)> listener) {
  std::lock_guard lock(mutex_);
  int id = next_++;
  listeners_[id] = std::move(listener);
  return std::shared_ptr<void>(nullptr, [this, id](void *) {
    std::lock_guard lock(mutex_);
    listeners_.erase(id);
  });
}

void NotificationEvents::send(const folly::dynamic &event) {
  std::map<int, std::function<void(const folly::dynamic &)>> listeners;
  {
    std::lock_guard lock(mutex_);
    listeners = listeners_;
  }
  for (auto &[_, listener] : listeners) {
    listener(event);
  }
}

namespace {

std::string stringArg(const folly::dynamic &args, size_t index) {
  return args.size() > index && args[index].isString() ? args[index].asString() : std::string{};
}

struct Notifications : NativeModule {
  Notifications(std::shared_ptr<NotificationCenter> center, std::shared_ptr<NotificationEvents> events)
      : NativeModule("NgNativeNotifications") {
    auto permissions = [center](bool ask) {
      return [center, ask](const folly::dynamic &, JsPromise promise) {
        if (!center->canPost()) {
          promise.resolve(permissionResponse(NotificationAuthorization::Denied, false));
          return;
        }
        center->authorization([center, ask, promise](NotificationAuthorization now) {
          if (!ask || now != NotificationAuthorization::NotDetermined) {
            promise.resolve(permissionResponse(now, true));
            return;
          }
          center->requestAuthorization(
              [promise](NotificationAuthorization answered) { promise.resolve(permissionResponse(answered, true)); });
        });
      };
    };
    promise("getPermissionsAsync", permissions(false));
    promise("requestPermissionsAsync", permissions(true));
    promise("scheduleNotificationAsync", [center](const folly::dynamic &args, JsPromise promise) {
      auto parsed = parseNotificationRequest(args.size() > 0 ? args[0] : folly::dynamic(nullptr));
      if (auto *problem = std::get_if<std::string>(&parsed)) {
        promise.reject(*problem);
        return;
      }
      // Denied is not absence: the call resolves empty (null) and the permission says why. A
      // build that cannot post at all reads as denied.
      if (!center->canPost()) {
        promise.resolve(nullptr);
        return;
      }
      auto request = std::get<NotificationRequest>(parsed);
      if (request.identifier.empty()) {
        static std::atomic<long> counter{0};
        request.identifier = "ngn-" + std::to_string(std::chrono::system_clock::now().time_since_epoch().count()) +
            "-" + std::to_string(++counter);
      }
      center->authorization([center, request, promise](NotificationAuthorization now) {
        if (now != NotificationAuthorization::Authorized) {
          promise.resolve(nullptr);
          return;
        }
        auto id = request.identifier;
        center->add(request, [promise, id](std::optional<std::string> error) {
          if (error) {
            promise.reject(*error);
          } else {
            promise.resolve(id);
          }
        });
      });
    });
    promise("getAllScheduledNotificationsAsync", [center](const folly::dynamic &, JsPromise promise) {
      if (!center->canPost()) {
        promise.resolve(folly::dynamic::array());
        return;
      }
      center->pending([promise](std::vector<NotificationRequest> requests) {
        auto out = folly::dynamic::array();
        for (const auto &request : requests) {
          out.push_back(notificationRequestJson(request));
        }
        promise.resolve(out);
      });
    });
    promise("getPresentedNotificationsAsync", [center](const folly::dynamic &, JsPromise promise) {
      if (!center->canPost()) {
        promise.resolve(folly::dynamic::array());
        return;
      }
      center->delivered([promise](std::vector<std::pair<double, NotificationRequest>> delivered) {
        auto out = folly::dynamic::array();
        for (const auto &[date, request] : delivered) {
          out.push_back(notificationJson(date, request));
        }
        promise.resolve(out);
      });
    });
    auto each = [center](void (NotificationCenter::*one)(const std::vector<std::string> &)) {
      return [center, one](const folly::dynamic &args, JsPromise promise) {
        if (center->canPost()) {
          ((*center).*one)({stringArg(args, 0)});
        }
        promise.resolve(nullptr);
      };
    };
    auto all = [center](void (NotificationCenter::*every)()) {
      return [center, every](const folly::dynamic &, JsPromise promise) {
        if (center->canPost()) {
          ((*center).*every)();
        }
        promise.resolve(nullptr);
      };
    };
    promise("cancelScheduledNotificationAsync", each(&NotificationCenter::removePending));
    promise("cancelAllScheduledNotificationsAsync", all(&NotificationCenter::removeAllPending));
    promise("dismissNotificationAsync", each(&NotificationCenter::removeDelivered));
    promise("dismissAllNotificationsAsync", all(&NotificationCenter::removeAllDelivered));
    promise("getNextTriggerDateAsync", [center](const folly::dynamic &args, JsPromise promise) {
      auto trigger = parseNotificationTrigger(args.size() > 0 ? args[0] : folly::dynamic(nullptr));
      if (auto *problem = std::get_if<std::string>(&trigger)) {
        promise.reject(*problem);
        return;
      }
      auto next = center->nextDate(std::get<NotificationTrigger>(trigger));
      promise.resolve(next ? folly::dynamic(*next) : folly::dynamic(nullptr));
    });
    promise("getLastNotificationResponseAsync", [events](const folly::dynamic &, JsPromise promise) {
      auto last = events->lastResponse();
      promise.resolve(last ? *last : folly::dynamic(nullptr));
    });
    promise("getBadgeCountAsync", [center](const folly::dynamic &, JsPromise promise) { promise.resolve(center->badge()); });
    promise("setBadgeCountAsync", [center](const folly::dynamic &args, JsPromise promise) {
      if (args.size() == 0 || !args[0].isNumber() || !whole(args[0].asDouble(), 0, 1e9)) {
        promise.resolve(false);
        return;
      }
      center->setBadge(static_cast<int>(args[0].asDouble()));
      promise.resolve(true);
    });
    listeners();
    subscription_ = events->listen([this](const folly::dynamic &event) { emit("ngNativeNotifications", event); });
  }
  std::shared_ptr<void> subscription_;
};

} // namespace

std::shared_ptr<NativeModule> makeNotificationsModule(
    std::shared_ptr<NotificationCenter> center,
    std::shared_ptr<NotificationEvents> events) {
  return std::make_shared<Notifications>(std::move(center), std::move(events));
}

} // namespace ngn
