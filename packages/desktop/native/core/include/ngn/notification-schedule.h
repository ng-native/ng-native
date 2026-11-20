// Scheduled local notifications for an OS with no scheduler of its own (Linux): the requests kept
// in a JSON file in the app's data folder, each with the time it next fires, and fired from a timer
// in the app's process. So a trigger fires only while the app runs; one that came due while it did
// not is delivered once as the schedule starts, and a repeating one then waits for its next time.
// The delivered ones are kept too, as the OS keeps no list an app can read.
//
// Times are ms since the epoch, and calendar components match in the local time zone (TZ). Any
// thread: `deliver` is called on the timer's.
#pragma once

#include "ngn/notifications.h"

#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace ngn {

// The first time after `after` that `components` match (notifications.h's names: year, month 1 to
// 12, day, weekday 1 (Sunday) to 7, hour, minute and second), as NSCalendar matches them: a unit
// smaller than every one named is at its start (`{ hour: 8 }` is 08:00:00), and a larger one is
// any. Nothing when no time will match, as for a year gone by or the 30th of February.
std::optional<double> nextCalendarMatch(const std::map<std::string, int> &components, double after);

// When `trigger` fires first if it is scheduled at `now`; nothing for a date gone by.
std::optional<double> firstFireDate(const NotificationTrigger &trigger, double now);

class NotificationSchedule {
 public:
  struct Clock {
    std::function<double()> now;
    // Calls `fn` once after `ms`, later and never from inside the call, on the backend's main
    // thread; the answer cancels it.
    std::function<std::function<void()>(double ms, std::function<void()> fn)> after;
  };

  // `path` is the file it keeps its requests in, read now. `deliver` presents one as it fires.
  NotificationSchedule(std::string path, Clock clock, std::function<void(const NotificationRequest &)> deliver);
  ~NotificationSchedule();
  NotificationSchedule(const NotificationSchedule &) = delete;
  NotificationSchedule &operator=(const NotificationSchedule &) = delete;

  // Delivers what came due while the app was not running, and waits for the next.
  void start();
  // Schedules `request`, replacing one with its identifier; a trigger of now delivers it at once.
  // False when the schedule could not be written: nothing changed, and the file is as it was.
  bool add(const NotificationRequest &request);
  std::vector<NotificationRequest> pending() const;
  void removePending(const std::vector<std::string> &identifiers);
  void removeAllPending();

  // What was delivered (and not dismissed) with when, oldest first, at most kKeptDelivered.
  std::vector<std::pair<double, NotificationRequest>> delivered() const;
  // The delivered one with `identifier`, as a click on it names it.
  std::optional<std::pair<double, NotificationRequest>> deliveredOne(const std::string &identifier) const;
  // Forgets delivered ones; the answer is the identifiers it had, for the backend to withdraw.
  std::vector<std::string> removeDelivered(const std::vector<std::string> &identifiers);
  std::vector<std::string> removeAllDelivered();

  static constexpr size_t kKeptDelivered = 64;
  // The longest the timer waits before it reads the clock again: a wait measured on a monotonic
  // clock stops while the computer sleeps, which the wall clock does not.
  static constexpr double kLongestWait = 60'000;

 private:
  struct State;
  std::shared_ptr<State> state_;
};

} // namespace ngn
