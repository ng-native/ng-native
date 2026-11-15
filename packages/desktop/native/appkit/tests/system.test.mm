// The core's System over AppKit (system.h): the colour scheme an override leaves behind.
#include "../system.h"

#import <AppKit/AppKit.h>

#include <doctest/doctest.h>

#include <memory>
#include <thread>
#include <vector>

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
  auto tell = [&](std::string scheme) { told.push_back(std::move(scheme)); };
  try {
    host->setColorScheme(other, tell);
    CHECK(host->colorScheme() == other);
    CHECK(told == std::vector<std::string>{other});
    host->setColorScheme(std::nullopt, tell);
    CHECK((NSApp.appearance == nil));
    CHECK(host->colorScheme() == system);
    // Told what the main thread read once it had read the system's scheme again.
    CHECK(told == std::vector<std::string>{other, system});
  } catch (...) {
    NSApp.appearance = before;
    throw;
  }
  NSApp.appearance = before;
}

TEST_CASE("Each colour scheme change queued from another thread tells the scheme it applied, not a later one's") {
  [NSApplication sharedApplication];
  NSAppearance *before = NSApp.appearance;
  NSApp.appearance = nil;
  std::string system = schemeOf(NSApp.effectiveAppearance);
  std::string other = system == "dark" ? "light" : "dark";
  auto host = ngn::appkit::makeSystem("dev.ngnative.system-test");
  auto told = std::make_shared<std::vector<std::string>>();
  auto tell = [told](std::string scheme) { told->push_back(std::move(scheme)); };
  try {
    // All three queue on the main queue before any applies, so each is overtaken by the next.
    std::thread([&] {
      host->setColorScheme(other, tell);
      host->setColorScheme(std::nullopt, tell);
      host->setColorScheme(other, tell);
    }).join();
    auto until = [NSDate dateWithTimeIntervalSinceNow:5];
    while (told->size() < 3 && [until timeIntervalSinceNow] > 0) {
      [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    }
    CHECK(*told == std::vector<std::string>{other, system, other});
  } catch (...) {
    NSApp.appearance = before;
    throw;
  }
  NSApp.appearance = before;
}
