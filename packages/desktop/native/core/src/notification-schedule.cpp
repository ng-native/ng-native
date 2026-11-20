#include "ngn/notification-schedule.h"

#include <folly/json.h>

#include <algorithm>
#include <cmath>
#include <ctime>
#include <fstream>
#include <mutex>
#include <sstream>

namespace ngn {

namespace {

// The units a calendar trigger names, largest first. A weekday is a day's.
enum Level { kYear, kMonth, kDay, kHour, kMinute, kSecond };

// The days in 400 Gregorian years: after it every date falls on the weekday it did.
constexpr int kDaysInCycle = 146097;

int levelOf(const std::string &name) {
  if (name == "year") return kYear;
  if (name == "month") return kMonth;
  if (name == "day" || name == "weekday") return kDay;
  if (name == "hour") return kHour;
  if (name == "minute") return kMinute;
  return kSecond;
}

// The values a unit may take: the one named, its first when it is smaller than every unit named,
// or any.
std::vector<int> candidates(const std::map<std::string, int> &components, const char *name, int smallest, int low, int high) {
  if (auto it = components.find(name); it != components.end()) {
    return {it->second};
  }
  if (levelOf(name) > smallest) {
    return {low};
  }
  std::vector<int> out;
  for (int v = low; v <= high; ++v) {
    out.push_back(v);
  }
  return out;
}

bool matches(const std::map<std::string, int> &components, const char *name, int value) {
  auto it = components.find(name);
  return it == components.end() || it->second == value;
}

double millis(time_t t) {
  return static_cast<double>(t) * 1000;
}

folly::dynamic triggerRecord(const NotificationTrigger &trigger) {
  folly::dynamic components = folly::dynamic::object();
  for (const auto &[name, value] : trigger.components) {
    components[name] = value;
  }
  return folly::dynamic::object("kind", static_cast<int>(trigger.kind))("seconds", trigger.seconds)("date", trigger.date)(
      "repeats", trigger.repeats)("components", std::move(components));
}

NotificationTrigger triggerFromRecord(const folly::dynamic &record) {
  NotificationTrigger out;
  out.kind = static_cast<NotificationTrigger::Kind>(record.getDefault("kind", 0).asInt());
  out.seconds = record.getDefault("seconds", 0).asDouble();
  out.date = record.getDefault("date", 0).asDouble();
  out.repeats = record.getDefault("repeats", false).asBool();
  auto components = record.getDefault("components", folly::dynamic::object());
  for (const auto &[name, value] : components.items()) {
    out.components[name.asString()] = static_cast<int>(value.asInt());
  }
  return out;
}

folly::dynamic requestRecord(const NotificationRequest &request) {
  auto json = notificationRequestJson(request);
  json["trigger"] = triggerRecord(request.trigger);
  return json;
}

std::optional<NotificationRequest> requestFromRecord(const folly::dynamic &record) {
  auto parsed = parseNotificationRequest(folly::dynamic::object("identifier", record["identifier"])("content", record["content"]));
  auto *request = std::get_if<NotificationRequest>(&parsed);
  if (!request) {
    return std::nullopt;
  }
  request->trigger = triggerFromRecord(record["trigger"]);
  return *request;
}

} // namespace

std::optional<double> nextCalendarMatch(const std::map<std::string, int> &components, double after) {
  int smallest = kYear;
  for (const auto &[name, value] : components) {
    smallest = std::max(smallest, levelOf(name));
  }
  if (components.empty()) {
    smallest = kSecond;
  }
  // The day `after` is in, then each one after it, in local time. The Gregorian calendar repeats,
  // weekdays included, every 400 years, so a rule that has not matched in that many days never will.
  time_t start = static_cast<time_t>(std::floor(after / 1000));
  struct tm day{};
  localtime_r(&start, &day);
  int year = day.tm_year, month = day.tm_mon, date = day.tm_mday;
  auto hours = candidates(components, "hour", smallest, 0, 23);
  auto minutes = candidates(components, "minute", smallest, 0, 59);
  auto seconds = candidates(components, "second", smallest, 0, 59);
  // A month or a day smaller than every unit named starts at its first: `{ year: 2030 }` is the
  // first of January.
  bool firstMonth = !components.count("month") && kMonth > smallest;
  bool firstDay = !components.count("day") && !components.count("weekday") && kDay > smallest;
  // A named year not yet come starts on its first day, and only that year is searched.
  int last = kDaysInCycle;
  if (auto it = components.find("year"); it != components.end() && it->second - 1900 > year) {
    year = it->second - 1900;
    month = 0;
    date = 1;
    last = 366;
  }
  for (int offset = 0; offset <= last; ++offset) {
    // Noon, so a daylight saving change on the way never moves the date.
    struct tm noon{};
    noon.tm_year = year;
    noon.tm_mon = month;
    noon.tm_mday = date + offset;
    noon.tm_hour = 12;
    noon.tm_isdst = -1;
    mktime(&noon);
    if (auto it = components.find("year"); it != components.end() && noon.tm_year + 1900 > it->second) {
      return std::nullopt;
    }
    if (!matches(components, "year", noon.tm_year + 1900) || !matches(components, "month", noon.tm_mon + 1) ||
        !matches(components, "day", noon.tm_mday) || !matches(components, "weekday", noon.tm_wday + 1) ||
        (firstMonth && noon.tm_mon != 0) || (firstDay && noon.tm_mday != 1)) {
      continue;
    }
    for (int h : hours) {
      for (int m : minutes) {
        for (int s : seconds) {
          struct tm at{};
          at.tm_year = noon.tm_year;
          at.tm_mon = noon.tm_mon;
          at.tm_mday = noon.tm_mday;
          at.tm_hour = h;
          at.tm_min = m;
          at.tm_sec = s;
          at.tm_isdst = -1;
          // A time a spring change skips comes out an hour on, as the clock reads then.
          double t = millis(mktime(&at));
          if (t > after) {
            return t;
          }
        }
      }
    }
  }
  return std::nullopt;
}

std::optional<double> firstFireDate(const NotificationTrigger &trigger, double now) {
  switch (trigger.kind) {
    case NotificationTrigger::Kind::Now:
      return now;
    case NotificationTrigger::Kind::Interval:
      return now + trigger.seconds * 1000;
    case NotificationTrigger::Kind::Date:
      return trigger.date > now ? std::optional<double>(trigger.date) : std::nullopt;
    case NotificationTrigger::Kind::Calendar:
      return nextCalendarMatch(trigger.components, now);
    case NotificationTrigger::Kind::Push:
      return std::nullopt;
  }
  return std::nullopt;
}

struct NotificationSchedule::State : std::enable_shared_from_this<NotificationSchedule::State> {
  struct Entry {
    NotificationRequest request;
    double next{0};
  };

  std::string path;
  Clock clock;
  std::function<void(const NotificationRequest &)> deliver;
  mutable std::mutex mutex;
  std::vector<Entry> pending;
  std::vector<std::pair<double, NotificationRequest>> delivered;
  std::function<void()> cancelTimer;
  bool started{false};

  void load() {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
      return;
    }
    std::stringstream text;
    text << in.rdbuf();
    try {
      auto json = folly::parseJson(text.str());
      for (const auto &item : json.getDefault("pending", folly::dynamic::array())) {
        if (auto request = requestFromRecord(item["request"])) {
          pending.push_back({*request, item["next"].asDouble()});
        }
      }
      for (const auto &item : json.getDefault("delivered", folly::dynamic::array())) {
        if (auto request = requestFromRecord(item["request"])) {
          delivered.emplace_back(item["date"].asDouble(), *request);
        }
      }
    } catch (const std::exception &) {
      // A file that does not read is a schedule with nothing in it.
      pending.clear();
      delivered.clear();
    }
  }

  // Under the lock. False when the file was not committed; the one before it is then as it was.
  bool save() const {
    folly::dynamic out = folly::dynamic::object("pending", folly::dynamic::array())("delivered", folly::dynamic::array());
    for (const auto &entry : pending) {
      out["pending"].push_back(folly::dynamic::object("request", requestRecord(entry.request))("next", entry.next));
    }
    for (const auto &[date, request] : delivered) {
      out["delivered"].push_back(folly::dynamic::object("request", requestRecord(request))("date", date));
    }
    auto temp = path + ".tmp";
    {
      std::ofstream file(temp, std::ios::binary | std::ios::trunc);
      file << folly::toJson(out);
      file.close();
      if (!file) {
        std::remove(temp.c_str());
        return false;
      }
    }
    if (std::rename(temp.c_str(), path.c_str()) != 0) {
      std::remove(temp.c_str());
      return false;
    }
    return true;
  }

  // Under the lock: the timer set for the soonest request, at most kLongestWait away.
  void arm() {
    if (cancelTimer) {
      cancelTimer();
      cancelTimer = nullptr;
    }
    if (pending.empty() || !started) {
      return;
    }
    double soonest = pending.front().next;
    for (const auto &entry : pending) {
      soonest = std::min(soonest, entry.next);
    }
    double wait = std::clamp(soonest - clock.now(), 0.0, kLongestWait);
    std::weak_ptr<State> weak = shared_from_this();
    cancelTimer = clock.after(wait, [weak] {
      if (auto self = weak.lock()) {
        self->fire();
      }
    });
  }

  // Delivers each request that is due, moves a repeating one to its next time and drops the rest.
  void fire() {
    std::vector<NotificationRequest> due;
    {
      std::lock_guard lock(mutex);
      double now = clock.now();
      std::vector<Entry> kept;
      for (auto &entry : pending) {
        if (entry.next > now) {
          kept.push_back(std::move(entry));
          continue;
        }
        due.push_back(entry.request);
        remember(now, entry.request);
        const auto &trigger = entry.request.trigger;
        if (!trigger.repeats) {
          continue;
        }
        std::optional<double> next;
        if (trigger.kind == NotificationTrigger::Kind::Interval) {
          // Times missed while the app was not running are not each delivered.
          double step = trigger.seconds * 1000;
          next = entry.next + step * (std::floor((now - entry.next) / step) + 1);
        } else if (trigger.kind == NotificationTrigger::Kind::Calendar) {
          next = nextCalendarMatch(trigger.components, now);
        }
        if (next) {
          entry.next = *next;
          kept.push_back(std::move(entry));
        }
      }
      pending = std::move(kept);
      if (!due.empty()) {
        save();
      }
      arm();
    }
    for (const auto &request : due) {
      deliver(request);
    }
  }

  // Under the lock.
  void remember(double date, const NotificationRequest &request) {
    std::erase_if(delivered, [&](const auto &item) { return item.second.identifier == request.identifier; });
    delivered.emplace_back(date, request);
    if (delivered.size() > kKeptDelivered) {
      delivered.erase(delivered.begin());
    }
  }
};

NotificationSchedule::NotificationSchedule(std::string path, Clock clock, std::function<void(const NotificationRequest &)> deliver)
    : state_(std::make_shared<State>()) {
  state_->path = std::move(path);
  state_->clock = std::move(clock);
  state_->deliver = std::move(deliver);
  state_->load();
}

NotificationSchedule::~NotificationSchedule() {
  std::lock_guard lock(state_->mutex);
  if (state_->cancelTimer) {
    state_->cancelTimer();
    state_->cancelTimer = nullptr;
  }
}

void NotificationSchedule::start() {
  {
    std::lock_guard lock(state_->mutex);
    state_->started = true;
  }
  state_->fire();
}

bool NotificationSchedule::add(const NotificationRequest &request) {
  std::lock_guard lock(state_->mutex);
  auto &pending = state_->pending;
  auto before = pending;
  std::erase_if(pending, [&](const auto &entry) { return entry.request.identifier == request.identifier; });
  if (auto next = firstFireDate(request.trigger, state_->clock.now())) {
    pending.push_back({request, *next});
  }
  if (!state_->save()) {
    pending = std::move(before);
    return false;
  }
  state_->arm();
  return true;
}

std::vector<NotificationRequest> NotificationSchedule::pending() const {
  std::lock_guard lock(state_->mutex);
  std::vector<NotificationRequest> out;
  for (const auto &entry : state_->pending) {
    if (entry.request.trigger.kind != NotificationTrigger::Kind::Now) {
      out.push_back(entry.request);
    }
  }
  return out;
}

void NotificationSchedule::removePending(const std::vector<std::string> &identifiers) {
  std::lock_guard lock(state_->mutex);
  std::erase_if(state_->pending, [&](const auto &entry) {
    return std::find(identifiers.begin(), identifiers.end(), entry.request.identifier) != identifiers.end();
  });
  state_->save();
  state_->arm();
}

void NotificationSchedule::removeAllPending() {
  std::lock_guard lock(state_->mutex);
  state_->pending.clear();
  state_->save();
  state_->arm();
}

std::vector<std::pair<double, NotificationRequest>> NotificationSchedule::delivered() const {
  std::lock_guard lock(state_->mutex);
  return state_->delivered;
}

std::optional<std::pair<double, NotificationRequest>> NotificationSchedule::deliveredOne(const std::string &identifier) const {
  std::lock_guard lock(state_->mutex);
  for (const auto &item : state_->delivered) {
    if (item.second.identifier == identifier) {
      return item;
    }
  }
  return std::nullopt;
}

std::vector<std::string> NotificationSchedule::removeDelivered(const std::vector<std::string> &identifiers) {
  std::lock_guard lock(state_->mutex);
  std::vector<std::string> removed;
  std::erase_if(state_->delivered, [&](const auto &item) {
    bool named = std::find(identifiers.begin(), identifiers.end(), item.second.identifier) != identifiers.end();
    if (named) {
      removed.push_back(item.second.identifier);
    }
    return named;
  });
  state_->save();
  return removed;
}

std::vector<std::string> NotificationSchedule::removeAllDelivered() {
  std::lock_guard lock(state_->mutex);
  std::vector<std::string> removed;
  for (const auto &item : state_->delivered) {
    removed.push_back(item.second.identifier);
  }
  state_->delivered.clear();
  state_->save();
  return removed;
}

} // namespace ngn
