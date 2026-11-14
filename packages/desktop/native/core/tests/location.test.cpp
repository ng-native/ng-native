#include "ngn/location.h"

#include <doctest/doctest.h>

#include <map>

using folly::dynamic;
using Authorization = ngn::LocationSource::Authorization;

namespace {

// A Mac whose location the test decides: the authorization, whether asking would change it, and
// the fixes it would give.
struct FakeLocation final : ngn::LocationSource {
  Authorization now{Authorization::NotDetermined};
  std::optional<Authorization> afterAsking;
  int asked{0};
  int fixesAsked{0};
  std::map<int, std::function<void(const Fix &)>> watches;
  int next{0};

  Authorization authorization() override {
    return now;
  }
  void requestAuthorization(std::function<void(Authorization)> done) override {
    asked++;
    if (afterAsking) {
      now = *afterAsking;
    }
    done(now);
  }
  void currentFix(double, std::function<void(std::optional<Fix>, std::string)> done) override {
    fixesAsked++;
    done(Fix{.latitude = 51.5, .longitude = -0.12, .altitude = 11, .accuracy = 35, .timestamp = 1.7e12}, "");
  }
  int watch(double, double, std::function<void(const Fix &)> fix) override {
    watches[++next] = std::move(fix);
    return next;
  }
  void stopWatching(int handle) override {
    watches.erase(handle);
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

} // namespace

TEST_CASE("NgNativeLocation answers the foreground permission in expo-location's shape") {
  auto mac = std::make_shared<FakeLocation>();
  auto module = ngn::makeLocationModule(mac, false);
  auto undetermined = ask(*module, "getForegroundPermissionsAsync").value;
  REQUIRE(undetermined);
  CHECK((*undetermined)["status"] == "undetermined");
  CHECK((*undetermined)["granted"] == false);
  CHECK((*undetermined)["canAskAgain"] == true);
  CHECK((*undetermined)["expires"] == "never");
  CHECK(mac->asked == 0);

  // The user says no.
  mac->afterAsking = Authorization::Denied;
  auto denied = ask(*module, "requestForegroundPermissionsAsync").value;
  REQUIRE(denied);
  CHECK(mac->asked == 1);
  CHECK((*denied)["status"] == "denied");
  CHECK((*denied)["canAskAgain"] == false);
  // Restricted by a profile reads as denied too, never to be asked again.
  mac->now = Authorization::Restricted;
  CHECK((*ask(*module, "getForegroundPermissionsAsync").value)["status"] == "denied");
  // Asking again once it is decided shows nothing.
  ask(*module, "requestForegroundPermissionsAsync");
  CHECK(mac->asked == 1);
}

TEST_CASE("NgNativeLocation never prompts with NGN_NO_PROMPTS, and answers what is decided") {
  auto mac = std::make_shared<FakeLocation>();
  mac->afterAsking = Authorization::Granted;
  auto module = ngn::makeLocationModule(mac, true);
  auto answer = ask(*module, "requestForegroundPermissionsAsync").value;
  REQUIRE(answer);
  CHECK(mac->asked == 0);
  CHECK((*answer)["status"] == "undetermined");
}

TEST_CASE("NgNativeLocation reads no position and watches nothing without the permission") {
  auto mac = std::make_shared<FakeLocation>();
  mac->now = Authorization::Denied;
  auto module = ngn::makeLocationModule(mac, false);
  auto fix = ask(*module, "getCurrentPositionAsync", dynamic::array(dynamic::object("accuracy", 3)));
  REQUIRE(fix.error);
  CHECK(fix.error->find("Not authorized") != std::string::npos);
  CHECK(mac->fixesAsked == 0);

  CHECK_THROWS_WITH_AS(module->subscribe("watchPositionAsync", dynamic::array(dynamic::object("accuracy", 3), nullptr),
                                          [](dynamic) {}),
                       doctest::Contains("Not authorized"), std::exception);
  CHECK(mac->watches.empty());
}

TEST_CASE("NgNativeLocation gives a fix and follows the position in expo-location's shape once granted") {
  auto mac = std::make_shared<FakeLocation>();
  mac->now = Authorization::Granted;
  auto module = ngn::makeLocationModule(mac, false);
  auto fix = ask(*module, "getCurrentPositionAsync", dynamic::array(dynamic::object("accuracy", 4))).value;
  REQUIRE(fix);
  CHECK((*fix)["coords"]["latitude"] == 51.5);
  CHECK((*fix)["coords"]["accuracy"] == 35);
  CHECK((*fix)["coords"]["heading"] == nullptr);
  CHECK((*fix)["timestamp"] == 1.7e12);

  std::vector<dynamic> seen;
  auto stop = module->subscribe("watchPositionAsync", dynamic::array(dynamic::object("accuracy", 4)("distanceInterval", 10), nullptr),
                                [&](dynamic args) { seen.push_back(args); });
  REQUIRE(mac->watches.size() == 1);
  mac->watches.begin()->second({.latitude = 1, .longitude = 2, .timestamp = 5});
  REQUIRE(seen.size() == 1);
  CHECK(seen[0][0]["coords"]["longitude"] == 2);
  stop();
  CHECK(mac->watches.empty());
  // Stopping twice, as a remove() called again, does nothing more.
  stop();
}

TEST_CASE("NgNativeLocation stops the watches still running when it goes, as on a reload") {
  auto mac = std::make_shared<FakeLocation>();
  mac->now = Authorization::Granted;
  {
    auto module = ngn::makeLocationModule(mac, false);
    module->subscribe("watchPositionAsync", dynamic::array(dynamic::object(), nullptr), [](dynamic) {});
    CHECK(mac->watches.size() == 1);
  }
  CHECK(mac->watches.empty());
}
