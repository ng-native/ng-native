// The notification schedule an OS with no scheduler uses (Linux's): calendar matching in local
// time, firing from a fake clock, the file it keeps, and what it delivers on a later launch.
#include "ngn/notification-schedule.h"

#include <doctest/doctest.h>

#include <unistd.h>

#include <algorithm>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace {

// The local time zone set for a test, and the one before restored after it.
struct TimeZone {
  std::optional<std::string> was;
  explicit TimeZone(const char *zone) {
    if (const char *tz = getenv("TZ")) {
      was = tz;
    }
    setenv("TZ", zone, 1);
    tzset();
  }
  ~TimeZone() {
    if (was) {
      setenv("TZ", was->c_str(), 1);
    } else {
      unsetenv("TZ");
    }
    tzset();
  }
};

// ms since the epoch of a UTC time.
double utc(int year, int month, int day, int hour = 0, int minute = 0, int second = 0) {
  struct tm at{};
  at.tm_year = year - 1900;
  at.tm_mon = month - 1;
  at.tm_mday = day;
  at.tm_hour = hour;
  at.tm_min = minute;
  at.tm_sec = second;
  return static_cast<double>(timegm(&at)) * 1000;
}

// A clock whose time moves only when a test moves it, running the timers that come due. Timers
// count on a monotonic clock, which stops while the computer sleeps (sleep) and the wall clock
// does not.
struct FakeClock {
  double now{0};
  double monotonic{0};
  struct Timer {
    double at;
    std::function<void()> fn;
    std::shared_ptr<bool> cancelled;
  };
  std::vector<Timer> timers;
  std::vector<double> waits;

  ngn::NotificationSchedule::Clock clock() {
    return {
        .now = [this] { return now; },
        .after =
            [this](double ms, std::function<void()> fn) {
              waits.push_back(ms);
              auto cancelled = std::make_shared<bool>(false);
              timers.push_back({monotonic + ms, std::move(fn), cancelled});
              return std::function<void()>([cancelled] { *cancelled = true; });
            },
    };
  }
  void advance(double ms) {
    double end = monotonic + ms;
    while (true) {
      auto due = std::find_if(timers.begin(), timers.end(), [&](const Timer &t) { return !*t.cancelled && t.at <= end; });
      if (due == timers.end()) {
        break;
      }
      auto timer = *due;
      timers.erase(due);
      now += std::max(0.0, timer.at - monotonic);
      monotonic = std::max(monotonic, timer.at);
      timer.fn();
    }
    now += end - monotonic;
    monotonic = end;
  }
  void sleep(double ms) {
    now += ms;
  }
  size_t live() const {
    return std::count_if(timers.begin(), timers.end(), [](const Timer &t) { return !*t.cancelled; });
  }
};

struct Folder {
  std::string path;
  Folder() {
    char name[] = "/tmp/ngn-notification-schedule-XXXXXX";
    REQUIRE(mkdtemp(name) != nullptr);
    path = name;
  }
  ~Folder() {
    std::filesystem::remove_all(path);
  }
  std::string file() const {
    return path + "/notifications.json";
  }
};

ngn::NotificationRequest request(const std::string &id, ngn::NotificationTrigger trigger) {
  ngn::NotificationRequest out;
  out.identifier = id;
  out.title = "Title " + id;
  out.body = "Body";
  out.data = folly::dynamic::object("n", 1);
  out.badge = 3;
  out.trigger = std::move(trigger);
  return out;
}

ngn::NotificationTrigger calendar(std::map<std::string, int> components, bool repeats = true) {
  return {.kind = ngn::NotificationTrigger::Kind::Calendar, .repeats = repeats, .components = std::move(components)};
}

} // namespace

TEST_CASE("A calendar trigger's next match: smaller units start at their first, larger ones are any") {
  TimeZone zone("UTC");
  double after = utc(2026, 11, 19, 10, 30, 15);  // a Thursday
  CHECK(ngn::nextCalendarMatch({{"hour", 8}, {"minute", 0}}, after) == utc(2026, 11, 20, 8, 0, 0));
  CHECK(ngn::nextCalendarMatch({{"hour", 11}}, after) == utc(2026, 11, 19, 11, 0, 0));
  CHECK(ngn::nextCalendarMatch({{"minute", 45}}, after) == utc(2026, 11, 19, 10, 45, 0));
  CHECK(ngn::nextCalendarMatch({{"second", 10}}, after) == utc(2026, 11, 19, 10, 31, 10));
  // Weekday 1 is Sunday.
  CHECK(ngn::nextCalendarMatch({{"weekday", 2}, {"hour", 9}, {"minute", 0}}, after) == utc(2026, 11, 23, 9, 0, 0));
  CHECK(ngn::nextCalendarMatch({{"day", 1}}, after) == utc(2026, 12, 1));
  CHECK(ngn::nextCalendarMatch({{"month", 3}}, after) == utc(2027, 3, 1));
  CHECK(ngn::nextCalendarMatch({{"year", 2030}}, after) == utc(2030, 1, 1));
  // The 29th of February, from a year with none.
  CHECK(ngn::nextCalendarMatch({{"month", 2}, {"day", 29}}, after) == utc(2028, 2, 29));
  // Strictly after.
  CHECK(ngn::nextCalendarMatch({{"hour", 10}, {"minute", 30}, {"second", 15}}, after) == utc(2026, 11, 20, 10, 30, 15));
  // Never.
  CHECK_FALSE(ngn::nextCalendarMatch({{"year", 2020}}, after));
  CHECK_FALSE(ngn::nextCalendarMatch({{"month", 2}, {"day", 30}}, after));
}

TEST_CASE("A calendar trigger matches the local time zone's clock") {
  TimeZone zone("EST5EDT,M3.2.0,M11.1.0");
  double after = utc(2026, 11, 19, 12);  // 07:00 in New York
  CHECK(ngn::nextCalendarMatch({{"hour", 8}}, after) == utc(2026, 11, 19, 13));
  // Either side of the change to summer time on the 14th of March 2027: 08:00 local is 13:00 UTC
  // before it and 12:00 UTC after.
  CHECK(ngn::nextCalendarMatch({{"month", 3}, {"day", 13}, {"hour", 8}}, after) == utc(2027, 3, 13, 13));
  CHECK(ngn::nextCalendarMatch({{"month", 3}, {"day", 15}, {"hour", 8}}, after) == utc(2027, 3, 15, 12));
}

TEST_CASE("firstFireDate reads each kind of trigger from now") {
  TimeZone zone("UTC");
  double now = utc(2026, 11, 19, 10);
  CHECK(ngn::firstFireDate({}, now) == now);
  CHECK(ngn::firstFireDate({.kind = ngn::NotificationTrigger::Kind::Interval, .seconds = 90}, now) == now + 90'000);
  CHECK(ngn::firstFireDate({.kind = ngn::NotificationTrigger::Kind::Date, .date = now + 5}, now) == now + 5);
  CHECK_FALSE(ngn::firstFireDate({.kind = ngn::NotificationTrigger::Kind::Date, .date = now - 5}, now));
  CHECK(ngn::firstFireDate(calendar({{"hour", 12}}), now) == utc(2026, 11, 19, 12));
}

TEST_CASE("The schedule fires each request at its time, repeats a repeating one and drops the rest") {
  TimeZone zone("UTC");
  Folder folder;
  FakeClock clock;
  clock.now = utc(2026, 11, 19, 10);
  std::vector<std::string> shown;
  ngn::NotificationSchedule schedule(folder.file(), clock.clock(), [&](const ngn::NotificationRequest &r) { shown.push_back(r.identifier); });
  schedule.start();

  schedule.add(request("now", {}));
  schedule.add(request("once", {.kind = ngn::NotificationTrigger::Kind::Interval, .seconds = 30}));
  schedule.add(request("every", {.kind = ngn::NotificationTrigger::Kind::Interval, .seconds = 120, .repeats = true}));
  schedule.add(request("noon", calendar({{"hour", 12}})));
  // A trigger of now is never listed as scheduled.
  CHECK(schedule.pending().size() == 3);

  clock.advance(0);
  CHECK(shown == std::vector<std::string>{"now"});
  clock.advance(30'000);
  CHECK(shown == std::vector<std::string>{"now", "once"});
  clock.advance(90'000);
  CHECK(shown.back() == "every");
  clock.advance(120'000);
  CHECK(std::count(shown.begin(), shown.end(), "every") == 2);
  CHECK(schedule.pending().size() == 2);

  clock.advance(utc(2026, 11, 19, 12) - clock.now);
  CHECK(shown.back() == "noon");
  // Then the next day's noon.
  clock.advance(utc(2026, 11, 20, 12) - clock.now - 1);
  CHECK(std::count(shown.begin(), shown.end(), "noon") == 1);
  clock.advance(1);
  CHECK(std::count(shown.begin(), shown.end(), "noon") == 2);

  // Delivered ones are kept, each once, newest last.
  auto delivered = schedule.delivered();
  REQUIRE(delivered.size() == 4);
  CHECK(delivered.back().second.identifier == "noon");
  CHECK(delivered.back().first == utc(2026, 11, 20, 12));
}

TEST_CASE("The schedule's timer never waits longer than a minute, and reads the wall clock as it wakes") {
  TimeZone zone("UTC");
  Folder folder;
  FakeClock clock;
  clock.now = utc(2026, 11, 19, 10);
  std::vector<std::string> shown;
  ngn::NotificationSchedule schedule(folder.file(), clock.clock(), [&](const ngn::NotificationRequest &r) { shown.push_back(r.identifier); });
  schedule.start();
  schedule.add(request("later", {.kind = ngn::NotificationTrigger::Kind::Date, .date = clock.now + 3'600'000}));
  CHECK(clock.waits.back() == ngn::NotificationSchedule::kLongestWait);
  // The computer slept for two hours: the next wake finds it due.
  clock.sleep(7'200'000);
  clock.advance(0);
  CHECK(shown.empty());
  clock.advance(ngn::NotificationSchedule::kLongestWait);
  CHECK(shown == std::vector<std::string>{"later"});
  CHECK(clock.live() == 0);
}

TEST_CASE("Cancelling stops a request, and replacing one by its identifier keeps one") {
  TimeZone zone("UTC");
  Folder folder;
  FakeClock clock;
  std::vector<std::string> shown;
  ngn::NotificationSchedule schedule(folder.file(), clock.clock(), [&](const ngn::NotificationRequest &r) { shown.push_back(r.identifier); });
  schedule.start();
  schedule.add(request("a", {.kind = ngn::NotificationTrigger::Kind::Interval, .seconds = 10}));
  schedule.add(request("a", {.kind = ngn::NotificationTrigger::Kind::Interval, .seconds = 20}));
  schedule.add(request("b", {.kind = ngn::NotificationTrigger::Kind::Interval, .seconds = 10}));
  CHECK(schedule.pending().size() == 2);
  schedule.removePending({"b"});
  clock.advance(15'000);
  CHECK(shown.empty());
  clock.advance(5'000);
  CHECK(shown == std::vector<std::string>{"a"});
  schedule.add(request("c", {.kind = ngn::NotificationTrigger::Kind::Interval, .seconds = 10}));
  schedule.removeAllPending();
  clock.advance(60'000);
  CHECK(shown.size() == 1);
  CHECK(clock.live() == 0);

  CHECK(schedule.removeDelivered({"x", "a"}) == std::vector<std::string>{"a"});
  CHECK(schedule.delivered().empty());
}

TEST_CASE("A later launch reads the schedule back and delivers what came due while the app was closed, once") {
  TimeZone zone("UTC");
  Folder folder;
  double closed = utc(2026, 11, 19, 10);
  {
    FakeClock clock;
    clock.now = closed;
    ngn::NotificationSchedule schedule(folder.file(), clock.clock(), [](const ngn::NotificationRequest &) {});
    schedule.start();
    schedule.add(request("missed", {.kind = ngn::NotificationTrigger::Kind::Interval, .seconds = 60}));
    schedule.add(request("hourly", {.kind = ngn::NotificationTrigger::Kind::Interval, .seconds = 3600, .repeats = true}));
    schedule.add(request("tomorrow", calendar({{"day", 20}, {"hour", 9}}, false)));
    schedule.add(request("daily", calendar({{"hour", 8}, {"minute", 30}})));
  }

  // Five hours later.
  FakeClock clock;
  clock.now = closed + 5 * 3'600'000;
  std::vector<ngn::NotificationRequest> shown;
  ngn::NotificationSchedule schedule(folder.file(), clock.clock(), [&](const ngn::NotificationRequest &r) { shown.push_back(r); });
  CHECK(schedule.pending().size() == 4);
  CHECK(shown.empty());
  schedule.start();
  REQUIRE(shown.size() == 2);
  CHECK(shown[0].identifier == "missed");
  CHECK(shown[1].identifier == "hourly");
  // What it was scheduled with comes back whole.
  CHECK(shown[0].title == "Title missed");
  CHECK(shown[0].body == "Body");
  CHECK(shown[0].badge == 3);
  CHECK(shown[0].data["n"] == 1);
  CHECK(shown[1].trigger.repeats);
  CHECK(shown[1].trigger.seconds == 3600);
  auto pending = schedule.pending();
  REQUIRE(pending.size() == 3);
  INFO(pending[0].identifier, pending[1].identifier, pending[2].identifier);
  CHECK(pending[2].identifier == "daily");
  CHECK(pending[2].trigger.kind == ngn::NotificationTrigger::Kind::Calendar);
  CHECK(pending[2].trigger.components.size() == 2);
  CHECK(pending[2].trigger.components["hour"] == 8);
  CHECK(pending[2].trigger.components["minute"] == 30);
  // The hourly one goes on from its own times, not from the launch.
  clock.advance(3'600'000 - 1);
  CHECK(shown.size() == 2);
  clock.advance(1);
  CHECK(shown.size() == 3);
  // And what was delivered before the launch is still listed.
  CHECK(schedule.deliveredOne("missed").has_value());
}

TEST_CASE("A schedule file that does not read is an empty schedule") {
  Folder folder;
  std::ofstream(folder.file()) << "{ not json";
  FakeClock clock;
  ngn::NotificationSchedule schedule(folder.file(), clock.clock(), [](const ngn::NotificationRequest &) {});
  schedule.start();
  CHECK(schedule.pending().empty());
  CHECK(schedule.delivered().empty());
}
