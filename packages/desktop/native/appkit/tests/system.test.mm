// The core's System over AppKit (system.h): the colour scheme an override leaves behind.
#include "../system.h"

#import <AppKit/AppKit.h>

#include <doctest/doctest.h>

namespace {

std::string schemeOf(NSAppearance *appearance) {
  NSAppearanceName match = [appearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameAqua, NSAppearanceNameDarkAqua ]];
  return [match isEqualToString:NSAppearanceNameDarkAqua] ? "dark" : "light";
}

} // namespace

TEST_CASE("Clearing the colour scheme override reads the system's scheme again, which may have changed under it") {
  [NSApplication sharedApplication];
  NSAppearance *before = NSApp.appearance;
  NSApp.appearance = nil;
  std::string system = schemeOf(NSApp.effectiveAppearance);
  std::string other = system == "dark" ? "light" : "dark";
  // The system's scheme as the host last read it, while an override held, differs from what the
  // system has now: as if the user switched it meanwhile.
  NSApp.appearance = [NSAppearance appearanceNamed:other == "dark" ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  auto host = ngn::appkit::makeSystem("dev.ngnative.system-test");
  std::vector<std::string> told;
  ngn::appkit::onSchemeRead(host, [&](std::string scheme) { told.push_back(std::move(scheme)); });
  try {
    host->setColorScheme(other);
    CHECK(host->colorScheme() == other);
    CHECK(told.empty());
    host->setColorScheme(std::nullopt);
    CHECK((NSApp.appearance == nil));
    CHECK(host->colorScheme() == system);
    // JavaScript may have read the stale scheme first: the one read on the main thread is told.
    CHECK(told == std::vector<std::string>{system});
  } catch (...) {
    NSApp.appearance = before;
    throw;
  }
  NSApp.appearance = before;
}
