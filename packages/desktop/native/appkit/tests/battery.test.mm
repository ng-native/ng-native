// MacPowerSource (battery.mm) on the Mac running the tests, against what pmset reports.
#include "../battery.h"

#include <doctest/doctest.h>

#import <Foundation/Foundation.h>

#include <cstdio>

namespace {

std::string pmsetBattery() {
  std::string out;
  FILE *pipe = popen("/usr/bin/pmset -g batt", "r");
  if (pipe == nullptr) {
    return out;
  }
  char buffer[256];
  while (fgets(buffer, sizeof buffer, pipe) != nullptr) {
    out += buffer;
  }
  pclose(pipe);
  return out;
}

} // namespace

TEST_CASE("MacPowerSource agrees with pmset on the battery and the adapter") {
  auto facts = ngn::appkit::makePowerSource()->facts();
  auto pmset = pmsetBattery();
  REQUIRE_FALSE(pmset.empty());
  CHECK(facts.hasBattery == (pmset.find("InternalBattery") != std::string::npos));
  CHECK(facts.externalPower == (pmset.find("'AC Power'") != std::string::npos));
  CHECK(facts.lowPowerMode == static_cast<bool>(NSProcessInfo.processInfo.isLowPowerModeEnabled));
  if (facts.hasBattery) {
    CHECK(facts.level > 0);
    CHECK(facts.level <= 1);
  } else {
    CHECK(ngn::batteryLevelOf(facts) == -1);
  }
}

TEST_CASE("MacPowerSource's watch stops") {
  auto source = ngn::appkit::makePowerSource();
  auto stop = source->watch([] {});
  stop();
}
