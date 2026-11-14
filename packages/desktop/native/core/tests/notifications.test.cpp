#include "ngn/notifications.h"

#include <doctest/doctest.h>
#include <folly/json.h>

using folly::dynamic;

namespace {

using Lines = std::vector<std::string>;

std::string json(const dynamic &value) {
  folly::json::serialization_opts opts;
  opts.sort_keys = true;
  return folly::json::serialize(value, opts);
}

struct FakeCenter final : ngn::NotificationCenter {
  bool posts{true};
  ngn::NotificationAuthorization status{ngn::NotificationAuthorization::NotDetermined};
  ngn::NotificationAuthorization answer{ngn::NotificationAuthorization::Denied};
  int asked{0};
  std::vector<ngn::NotificationRequest> added;
  Lines removed;
  int badgeCount{0};

  bool canPost() override {
    return posts;
  }
  void authorization(std::function<void(ngn::NotificationAuthorization)> done) override {
    done(status);
  }
  void requestAuthorization(std::function<void(ngn::NotificationAuthorization)> done) override {
    ++asked;
    status = answer;
    done(answer);
  }
  void add(const ngn::NotificationRequest &request, std::function<void(std::optional<std::string>)> done) override {
    added.push_back(request);
    done(std::nullopt);
  }
  void pending(std::function<void(std::vector<ngn::NotificationRequest>)> done) override {
    done(added);
  }
  void delivered(std::function<void(std::vector<std::pair<double, ngn::NotificationRequest>>)> done) override {
    done({});
  }
  void removePending(const std::vector<std::string> &ids) override {
    removed.push_back("pending " + ids.at(0));
  }
  void removeAllPending() override {
    removed.push_back("all pending");
  }
  void removeDelivered(const std::vector<std::string> &ids) override {
    removed.push_back("delivered " + ids.at(0));
  }
  void removeAllDelivered() override {
    removed.push_back("all delivered");
  }
  std::optional<double> nextDate(const ngn::NotificationTrigger &trigger) override {
    return trigger.kind == ngn::NotificationTrigger::Kind::Date ? std::optional<double>(trigger.date) : std::nullopt;
  }
  int badge() override {
    return badgeCount;
  }
  void setBadge(int count) override {
    badgeCount = count;
  }
};

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer ask(const ngn::NativeModule &module, const std::string &method, dynamic args = dynamic::array()) {
  Answer answer;
  module.callWithPromise(
      method, args,
      {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

ngn::NotificationTrigger trigger(const dynamic &raw) {
  auto parsed = ngn::parseNotificationTrigger(raw);
  REQUIRE(std::holds_alternative<ngn::NotificationTrigger>(parsed));
  return std::get<ngn::NotificationTrigger>(parsed);
}

std::string problem(const dynamic &raw) {
  auto parsed = ngn::parseNotificationTrigger(raw);
  return std::holds_alternative<std::string>(parsed) ? std::get<std::string>(parsed) : "";
}

} // namespace

TEST_CASE("Expo's triggers are read into the OS's: now, an interval, a date and calendar components") {
  using Kind = ngn::NotificationTrigger::Kind;
  CHECK(trigger(nullptr).kind == Kind::Now);
  auto interval = trigger(dynamic::object("type", "timeInterval")("seconds", 90)("repeats", true));
  CHECK(interval.kind == Kind::Interval);
  CHECK(interval.seconds == 90);
  CHECK(interval.repeats);
  // The legacy shape with no type.
  CHECK(trigger(dynamic::object("seconds", 5)).kind == Kind::Interval);
  auto date = trigger(dynamic::object("type", "date")("date", 1.8e12));
  CHECK(date.kind == Kind::Date);
  CHECK(date.date == 1.8e12);
  CHECK(trigger(1.8e12).date == 1.8e12);

  auto daily = trigger(dynamic::object("type", "daily")("hour", 9)("minute", 30));
  CHECK(daily.kind == Kind::Calendar);
  CHECK(daily.repeats);
  CHECK(daily.components == std::map<std::string, int>{{"hour", 9}, {"minute", 30}});
  CHECK(trigger(dynamic::object("type", "weekly")("weekday", 2)("hour", 9)("minute", 0)).components.at("weekday") == 2);
  // Expo's yearly month counts from 0; the OS's from 1.
  CHECK(trigger(dynamic::object("type", "yearly")("month", 0)("day", 1)("hour", 0)("minute", 0)).components.at("month") == 1);
  auto once = trigger(dynamic::object("type", "calendar")("year", 2027)("month", 3)("day", 4)("hour", 5));
  CHECK_FALSE(once.repeats);
  CHECK(once.components.size() == 4);
}

TEST_CASE("a trigger the OS would refuse or misread is refused with why") {
  CHECK(problem(dynamic::object("type", "timeInterval")("seconds", 0)) != "");
  CHECK(problem(dynamic::object("type", "timeInterval")("seconds", 30)("repeats", true)).find("60") != std::string::npos);
  CHECK(problem(dynamic::object("type", "daily")("hour", 9)).find("minute") != std::string::npos);
  CHECK(problem(dynamic::object("type", "daily")("hour", 24)("minute", 0)).find("hour") != std::string::npos);
  CHECK(problem(dynamic::object("type", "weekly")("weekday", 0)("hour", 1)("minute", 0)) != "");
  CHECK(problem(dynamic::object("type", "calendar")) != "");
  CHECK(problem(dynamic::object("type", "date")) != "");
  CHECK(problem(dynamic::object("type", "location")).find("location") != std::string::npos);
  CHECK(problem("tomorrow") != "");
}

TEST_CASE("a request is read with its content and reported back as Expo reports it") {
  auto parsed = ngn::parseNotificationRequest(dynamic::object("identifier", "tea")(
      "content", dynamic::object("title", "Tea")("body", "Ready")("data", dynamic::object("cup", 2))("sound", true)("badge", 3))(
      "trigger", dynamic::object("type", "daily")("hour", 16)("minute", 0)));
  REQUIRE(std::holds_alternative<ngn::NotificationRequest>(parsed));
  auto request = std::get<ngn::NotificationRequest>(parsed);
  CHECK(request.sound == "default");
  CHECK(
      json(ngn::notificationRequestJson(request)) ==
      R"({"content":{"badge":3,"body":"Ready","data":{"cup":2},"sound":"default","subtitle":null,"title":"Tea"},)"
      R"("identifier":"tea","trigger":{"dateComponents":{"hour":16,"minute":0},"repeats":true,"type":"calendar"}})");
  CHECK(std::holds_alternative<std::string>(ngn::parseNotificationRequest(dynamic::object("identifier", "x"))));
  CHECK(std::holds_alternative<std::string>(
      ngn::parseNotificationRequest(dynamic::object("content", dynamic::object("badge", -1)))));
}

TEST_CASE("permission is asked for only by requestPermissionsAsync, and only while undetermined") {
  auto center = std::make_shared<FakeCenter>();
  auto module = ngn::makeNotificationsModule(center, std::make_shared<ngn::NotificationEvents>());
  CHECK(
      json(*ask(*module, "getPermissionsAsync").value) ==
      R"({"canAskAgain":true,"expires":"never","granted":false,"status":"undetermined"})");
  CHECK(center->asked == 0);
  // The user says no: denied, and never asked again.
  CHECK((*ask(*module, "requestPermissionsAsync").value)["status"] == "denied");
  CHECK((*ask(*module, "requestPermissionsAsync").value)["canAskAgain"] == false);
  CHECK(center->asked == 1);

  // Granted another time.
  center->status = ngn::NotificationAuthorization::NotDetermined;
  center->answer = ngn::NotificationAuthorization::Authorized;
  CHECK((*ask(*module, "requestPermissionsAsync").value)["granted"] == true);

  // A host that cannot post at all answers denied without asking.
  center->posts = false;
  center->status = ngn::NotificationAuthorization::NotDetermined;
  auto answer = *ask(*module, "requestPermissionsAsync").value;
  CHECK(answer["status"] == "denied");
  CHECK(answer["canAskAgain"] == false);
  CHECK(center->asked == 2);
  CHECK(*ask(*module, "scheduleNotificationAsync", dynamic::array(dynamic::object("content", dynamic::object()))).value == nullptr);
  CHECK(*ask(*module, "getAllScheduledNotificationsAsync").value == dynamic::array());
  CHECK(center->added.empty());
}

TEST_CASE("without permission scheduling resolves null and schedules nothing") {
  auto center = std::make_shared<FakeCenter>();
  auto module = ngn::makeNotificationsModule(center, std::make_shared<ngn::NotificationEvents>());
  for (auto status : {ngn::NotificationAuthorization::NotDetermined, ngn::NotificationAuthorization::Denied}) {
    center->status = status;
    auto answer = ask(*module, "scheduleNotificationAsync", dynamic::array(dynamic::object("content", dynamic::object())));
    CHECK(*answer.value == nullptr);
  }
  CHECK(center->added.empty());
  // Asking is the app's to do: scheduling never asks.
  CHECK(center->asked == 0);
}

TEST_CASE("scheduling gives a request an identifier when it has none, and cancelling names it") {
  auto center = std::make_shared<FakeCenter>();
  center->status = ngn::NotificationAuthorization::Authorized;
  auto module = ngn::makeNotificationsModule(center, std::make_shared<ngn::NotificationEvents>());
  auto first = ask(*module, "scheduleNotificationAsync", dynamic::array(dynamic::object("content", dynamic::object("title", "A"))));
  auto second = ask(*module, "scheduleNotificationAsync", dynamic::array(dynamic::object("content", dynamic::object("title", "B"))));
  REQUIRE(first.value);
  REQUIRE(second.value);
  CHECK(first.value->asString() != second.value->asString());
  CHECK(center->added.at(0).identifier == first.value->asString());
  auto named = ask(*module, "scheduleNotificationAsync", dynamic::array(dynamic::object("identifier", "tea")("content", dynamic::object())));
  CHECK(*named.value == "tea");
  CHECK(ask(*module, "scheduleNotificationAsync", dynamic::array(dynamic::object("content", dynamic::object())("trigger", dynamic::object("type", "daily"))))
            .error);
  CHECK(ask(*module, "getAllScheduledNotificationsAsync").value->size() == 3);

  ask(*module, "cancelScheduledNotificationAsync", dynamic::array("tea"));
  ask(*module, "cancelAllScheduledNotificationsAsync");
  ask(*module, "dismissNotificationAsync", dynamic::array("old"));
  ask(*module, "dismissAllNotificationsAsync");
  CHECK(center->removed == Lines{"pending tea", "all pending", "delivered old", "all delivered"});
  CHECK(*ask(*module, "getNextTriggerDateAsync", dynamic::array(dynamic::object("type", "date")("date", 5000))).value == 5000);
}

TEST_CASE("the badge count is the Dock badge, a whole number from 0") {
  auto center = std::make_shared<FakeCenter>();
  auto module = ngn::makeNotificationsModule(center, std::make_shared<ngn::NotificationEvents>());
  CHECK(*ask(*module, "setBadgeCountAsync", dynamic::array(4)).value == true);
  CHECK(*ask(*module, "getBadgeCountAsync").value == 4);
  CHECK(*ask(*module, "setBadgeCountAsync", dynamic::array(-1)).value == false);
  CHECK(*ask(*module, "setBadgeCountAsync", dynamic::array(1.5)).value == false);
  CHECK(center->badgeCount == 4);
  CHECK(ngn::badgeLabel(4) == "4");
  CHECK(ngn::badgeLabel(0).empty());
}

TEST_CASE("a delivered notification and a click reach the app, and the click that launched it waits") {
  auto center = std::make_shared<FakeCenter>();
  auto events = std::make_shared<ngn::NotificationEvents>();
  ngn::NotificationRequest request;
  request.identifier = "tea";
  request.title = "Tea";
  // The click that launched the app comes before any module.
  events->responded(1000, request);
  auto module = ngn::makeNotificationsModule(center, events);
  Lines heard;
  module->setEmitter([&](const std::string &name, dynamic body) { heard.push_back(name + " " + body["type"].asString()); });
  auto last = ask(*module, "getLastNotificationResponseAsync").value;
  REQUIRE(last);
  CHECK((*last)["actionIdentifier"] == "expo.modules.notifications.actions.DEFAULT");
  CHECK((*last)["notification"]["request"]["identifier"] == "tea");
  CHECK((*last)["notification"]["date"] == 1000);

  events->received(2000, request);
  events->responded(3000, request);
  CHECK(heard == Lines{"ngNativeNotifications received", "ngNativeNotifications response"});
  module.reset();
  events->received(4000, request);
  CHECK(heard.size() == 2);
}
