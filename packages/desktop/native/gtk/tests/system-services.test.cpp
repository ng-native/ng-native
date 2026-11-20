// Battery, Network and Location on Linux, against stand-ins for UPower, power-profiles-daemon,
// NetworkManager and the Location portal over a peer-to-peer connection. What the modules make of
// the facts is the core's.
#include "../battery.h"
#include "../dbus-properties.h"
#include "../location.h"
#include "../network-state.h"
#include "mounted-views.h"
#include "stand-in-services.h"

#include <doctest/doctest.h>

#include <optional>
#include <vector>

using ngn::testing::StandInServices;

namespace {

// Runs the main loop a tenth of a second: whatever was coming has come.
void settle() {
  gint64 until = g_get_monotonic_time() + 100 * 1000;
  ngn::testing::runUntil([until] { return g_get_monotonic_time() > until; });
}

constexpr const char *kDisplay = "/org/freedesktop/UPower/devices/DisplayDevice";

void addUPower(StandInServices &services, bool present, double percentage, guint32 state, bool onBattery) {
  services.add(kDisplay, "org.freedesktop.UPower.Device", {{"IsPresent", "b"}, {"Type", "u"}, {"Percentage", "d"}, {"State", "u"}},
               {{"IsPresent", g_variant_new_boolean(present)},
                {"Type", g_variant_new_uint32(2)},
                {"Percentage", g_variant_new_double(percentage)},
                {"State", g_variant_new_uint32(state)}});
  services.add("/org/freedesktop/UPower", "org.freedesktop.UPower", {{"OnBattery", "b"}}, {{"OnBattery", g_variant_new_boolean(onBattery)}});
}

} // namespace

TEST_CASE("Battery on Linux reads UPower's display device and power-profiles-daemon's profile, and hears them change") {
  REQUIRE(ngn::testing::gtkReady());
  StandInServices services;
  addUPower(services, true, 64, 2, true);
  services.add("/net/hadess/PowerProfiles", "net.hadess.PowerProfiles", {{"ActiveProfile", "s"}},
               {{"ActiveProfile", g_variant_new_string("balanced")}});
  auto power = ngn::gtk::makePowerSource(services.client);
  int changes = 0;
  auto stop = power->watch([&changes] { ++changes; });
  ngn::testing::runUntil([&] { return power->facts().hasBattery; });
  auto facts = power->facts();
  CHECK(facts.level == doctest::Approx(0.64));
  CHECK_FALSE(facts.charging);
  CHECK_FALSE(facts.externalPower);
  CHECK_FALSE(facts.lowPowerMode);
  CHECK(ngn::batteryStateOf(facts) == 1);

  int before = changes;
  services.set(kDisplay, "State", g_variant_new_uint32(1));
  services.set("/org/freedesktop/UPower", "OnBattery", g_variant_new_boolean(false));
  services.set("/net/hadess/PowerProfiles", "ActiveProfile", g_variant_new_string("power-saver"));
  ngn::testing::runUntil([&] { return power->facts().lowPowerMode && power->facts().charging; });
  CHECK(changes > before);
  CHECK(power->facts().externalPower);
  CHECK(ngn::batteryStateOf(power->facts()) == 2);

  services.set(kDisplay, "State", g_variant_new_uint32(4));
  services.set(kDisplay, "Percentage", g_variant_new_double(100));
  ngn::testing::runUntil([&] { return power->facts().charged; });
  CHECK(ngn::batteryStateOf(power->facts()) == 3);
  stop();
}

TEST_CASE("Battery on Linux takes the PowerProfileMonitor portal's answer first, and has no battery without UPower's") {
  REQUIRE(ngn::testing::gtkReady());
  StandInServices services;
  services.add("/org/freedesktop/portal/desktop", "org.freedesktop.portal.PowerProfileMonitor", {{"power-saver-enabled", "b"}},
               {{"power-saver-enabled", g_variant_new_boolean(true)}});
  services.add("/net/hadess/PowerProfiles", "net.hadess.PowerProfiles", {{"ActiveProfile", "s"}},
               {{"ActiveProfile", g_variant_new_string("balanced")}});
  auto power = ngn::gtk::makePowerSource(services.client);
  ngn::testing::runUntil([&] { return power->facts().lowPowerMode; });
  // No UPower to ask: a desktop with no battery, as far as the app can tell.
  CHECK_FALSE(power->facts().hasBattery);
  CHECK(ngn::batteryLevelOf(power->facts()) == -1);
  auto module = ngn::makeBatteryModule(power);
  CHECK(module);
}

TEST_CASE("Battery on Linux with a desktop's line-powered display device has no battery") {
  REQUIRE(ngn::testing::gtkReady());
  StandInServices services;
  addUPower(services, false, 0, 0, false);
  auto power = ngn::gtk::makePowerSource(services.client);
  bool heard = false;
  auto stop = power->watch([&heard] { heard = true; });
  ngn::testing::runUntil([&] { return heard && power->facts().externalPower; });
  CHECK_FALSE(power->facts().hasBattery);
  stop();
}

TEST_CASE("Network on Linux names NetworkManager's primary connection type") {
  CHECK(ngn::gtk::networkPathOf(true, "802-11-wireless").wifi);
  CHECK(ngn::gtk::networkPathOf(true, "802-3-ethernet").ethernet);
  CHECK(ngn::gtk::networkPathOf(true, "gsm").cellular);
  CHECK(ngn::gtk::networkPathOf(true, "vpn").other);
  CHECK(ngn::gtk::networkPathOf(true, "").other);
  CHECK(ngn::gtk::networkPathOf(false, "802-11-wireless") == ngn::NetworkPath{});
  CHECK(ngn::networkStateOf(ngn::gtk::networkPathOf(true, "802-11-wireless"))["type"] == "WIFI");
}

TEST_CASE("Network on Linux hears NetworkManager's connection change") {
  REQUIRE(ngn::testing::gtkReady());
  StandInServices services;
  services.add("/org/freedesktop/NetworkManager", "org.freedesktop.NetworkManager", {{"PrimaryConnectionType", "s"}},
               {{"PrimaryConnectionType", g_variant_new_string("802-11-wireless")}});
  auto monitor = ngn::gtk::makePathMonitor(services.client);
  std::vector<ngn::NetworkPath> paths;
  auto stop = monitor->watch([&paths](const ngn::NetworkPath &path) { paths.push_back(path); });
  REQUIRE_FALSE(paths.empty());
  bool available = g_network_monitor_get_network_available(g_network_monitor_get_default());
  if (!available) {
    MESSAGE("no route in this container: every path is unsatisfied");
    CHECK_FALSE(paths.back().satisfied);
    stop();
    return;
  }
  ngn::testing::runUntil([&] { return paths.back().wifi; });
  services.set("/org/freedesktop/NetworkManager", "PrimaryConnectionType", g_variant_new_string("802-3-ethernet"));
  ngn::testing::runUntil([&] { return paths.back().ethernet; });
  CHECK(paths.back().satisfied);
  stop();
  auto count = paths.size();
  services.set("/org/freedesktop/NetworkManager", "PrimaryConnectionType", g_variant_new_string("gsm"));
  settle();
  CHECK(paths.size() == count);
}

TEST_CASE("Location on Linux maps an accuracy in metres to the portal's levels") {
  CHECK(ngn::gtk::portalAccuracyOf(0) == 5);
  CHECK(ngn::gtk::portalAccuracyOf(5) == 5);
  CHECK(ngn::gtk::portalAccuracyOf(50) == 4);
  CHECK(ngn::gtk::portalAccuracyOf(500) == 3);
  CHECK(ngn::gtk::portalAccuracyOf(3000) == 2);
  CHECK(ngn::gtk::portalAccuracyOf(100000) == 1);
}

TEST_CASE("Location on Linux takes a fix from a Location portal session, and closes it") {
  REQUIRE(ngn::testing::gtkReady());
  ngn::testing::StandInPortal portal;
  portal.fix = {{"Latitude", 51.5}, {"Longitude", -0.12}, {"Accuracy", 30}, {"Altitude", -1.7976931348623157e308}, {"Speed", -1}};
  auto location = ngn::gtk::makeLocationSource();
  CHECK(location->authorization() == ngn::LocationSource::Authorization::NotDetermined);
  std::optional<ngn::LocationSource::Authorization> decided;
  location->requestAuthorization([&decided](auto answer) { decided = answer; });
  ngn::testing::runUntil([&] { return decided.has_value(); });
  CHECK(*decided == ngn::LocationSource::Authorization::Granted);

  std::optional<ngn::LocationSource::Fix> fix;
  std::string error = "unanswered";
  location->currentFix(100, [&](std::optional<ngn::LocationSource::Fix> got, std::string why) {
    fix = got;
    error = why;
  });
  ngn::testing::runUntil([&] { return error != "unanswered"; });
  REQUIRE(fix);
  CHECK(fix->latitude == 51.5);
  CHECK(fix->longitude == -0.12);
  CHECK(fix->accuracy == 30);
  CHECK_FALSE(fix->altitude);
  CHECK_FALSE(fix->speed);
  CHECK(fix->timestamp == 1700000000000.0);
  // The permission's session and the fix's, each created, started and closed again.
  ngn::testing::runUntil([&] { return portal.closedSessions.size() == 2; });
  REQUIRE(portal.sessions.size() == 2);
  CHECK(portal.sessions[1].accuracy == 4);
}

TEST_CASE("Location on Linux is denied when the portal refuses, and restricted with no portal") {
  REQUIRE(ngn::testing::gtkReady());
  {
    ngn::testing::StandInPortal portal;
    portal.response = 1;
    auto location = ngn::gtk::makeLocationSource();
    std::optional<ngn::LocationSource::Authorization> decided;
    location->requestAuthorization([&decided](auto answer) { decided = answer; });
    ngn::testing::runUntil([&] { return decided.has_value(); });
    CHECK(*decided == ngn::LocationSource::Authorization::Denied);
  }
  {
    ngn::testing::StandInPortal portal;
    portal.offersLocation = false;
    auto location = ngn::gtk::makeLocationSource();
    std::optional<ngn::LocationSource::Authorization> decided;
    location->requestAuthorization([&decided](auto answer) { decided = answer; });
    ngn::testing::runUntil([&] { return decided.has_value(); });
    CHECK(*decided == ngn::LocationSource::Authorization::Restricted);
  }
}

TEST_CASE("Location on Linux watches through a session, each update a fix, until stopped") {
  REQUIRE(ngn::testing::gtkReady());
  ngn::testing::StandInPortal portal;
  portal.fix = {{"Latitude", 1.0}, {"Longitude", 2.0}};
  auto location = ngn::gtk::makeLocationSource();
  std::vector<ngn::LocationSource::Fix> fixes;
  int handle = location->watch(10, 25, [&fixes](const ngn::LocationSource::Fix &fix) { fixes.push_back(fix); });
  ngn::testing::runUntil([&] { return fixes.size() == 1; });
  REQUIRE(portal.sessions.size() == 1);
  CHECK(portal.sessions[0].distance == 25);
  portal.update(portal.sessions[0].path, {{"Latitude", 1.5}, {"Longitude", 2.5}});
  ngn::testing::runUntil([&] { return fixes.size() == 2; });
  CHECK(fixes[1].latitude == 1.5);
  location->stopWatching(handle);
  ngn::testing::runUntil([&] { return portal.closedSessions.size() == 1; });
  portal.update(portal.sessions[0].path, {{"Latitude", 9.0}, {"Longitude", 9.0}});
  settle();
  CHECK(fixes.size() == 2);
}

TEST_CASE("Location on Linux closes a fix's session when the fix comes before Start answers") {
  REQUIRE(ngn::testing::gtkReady());
  ngn::testing::StandInPortal portal;
  portal.fix = {{"Latitude", 51.5}, {"Longitude", -0.12}};
  portal.fixBeforeResponse = true;
  auto location = ngn::gtk::makeLocationSource();
  std::optional<ngn::LocationSource::Fix> fix;
  location->currentFix(100, [&](std::optional<ngn::LocationSource::Fix> got, std::string) { fix = got; });
  ngn::testing::runUntil([&] { return fix.has_value(); });
  REQUIRE(fix);
  // Closed now, not left open until a timeout that never closes it.
  ngn::testing::runUntil([&] { return !portal.closedSessions.empty(); });
  REQUIRE(portal.sessions.size() == 1);
  CHECK(portal.closedSessions == std::vector<std::string>{portal.sessions[0].path});
}

TEST_CASE("Location on Linux starts nothing for a watch stopped while its session is being made") {
  REQUIRE(ngn::testing::gtkReady());
  ngn::testing::StandInPortal portal;
  portal.fix = {{"Latitude", 1.0}, {"Longitude", 2.0}};
  auto location = ngn::gtk::makeLocationSource();
  std::vector<ngn::LocationSource::Fix> fixes;
  int handle = location->watch(10, 25, [&fixes](const ngn::LocationSource::Fix &fix) { fixes.push_back(fix); });
  // Both on the main context, in order: the stop is before CreateSession has answered.
  location->stopWatching(handle);
  ngn::testing::runUntil([&] { return !portal.closedSessions.empty(); });
  settle();
  REQUIRE(portal.sessions.size() == 1);
  CHECK(portal.closedSessions == std::vector<std::string>{portal.sessions[0].path});
  // Never started, so no fix, and nothing left to hear one.
  CHECK(fixes.empty());
  portal.update(portal.sessions[0].path, {{"Latitude", 9.0}, {"Longitude", 9.0}});
  settle();
  CHECK(fixes.empty());
}

TEST_CASE("a D-Bus properties watch stopped by another listener is not called, and none is after its stop") {
  REQUIRE(ngn::testing::gtkReady());
  StandInServices services;
  addUPower(services, true, 64, 2, true);
  ngn::gtk::DBusProperties object(G_BUS_TYPE_SYSTEM, services.client, "org.freedesktop.UPower", "/org/freedesktop/UPower",
                                  "org.freedesktop.UPower");
  std::function<void()> stopSecond;
  int first = 0, second = 0;
  auto stopFirst = object.watch([&] {
    ++first;
    // The second was registered after: the round already copied it.
    stopSecond();
  });
  stopSecond = object.watch([&] { ++second; });
  ngn::testing::runUntil([&] { return object.ready() && first > 0; });
  settle();
  CHECK(first >= 1);
  CHECK(second == 0);
  services.set("/org/freedesktop/UPower", "OnBattery", g_variant_new_boolean(false));
  settle();
  CHECK(second == 0);
  stopFirst();
}
