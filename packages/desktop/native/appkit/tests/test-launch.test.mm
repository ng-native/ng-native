// A test launch's AppKit half (test-launch.mm, removeStaleTestItems): its folders, its defaults
// suite, windows shown without focus, and what it removes as it ends. The test launch it sets
// stays set for the process; no other test here reads it.
#include "../desktop-expo.h"
#include "../test-launch.h"

#include <doctest/doctest.h>

#import <AppKit/AppKit.h>
#import <Security/Security.h>

#include <filesystem>
#include <string>
#include <unistd.h>

namespace {

NSString *ns(const std::string &s) {
  return [NSString stringWithUTF8String:s.c_str()];
}

NSDictionary *item(const std::string &service) {
  return @{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : ns(service),
    (__bridge id)kSecAttrAccount : @"key",
  };
}

bool exists(const std::string &service) {
  NSMutableDictionary *query = [item(service) mutableCopy];
  query[(__bridge id)kSecReturnAttributes] = @YES;
  CFTypeRef found = nullptr;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &found);
  if (found != nullptr) {
    CFRelease(found);
  }
  return status == errSecSuccess;
}

bool has(NSUserDefaults *defaults, NSString *key) {
  return [defaults objectForKey:key] != nil;
}

NSUserDefaults *suite(const ngn::TestLaunch &test) {
  return [[NSUserDefaults alloc] initWithSuiteName:ns(test.defaultsSuite())];
}

void add(const std::string &service) {
  NSMutableDictionary *query = [item(service) mutableCopy];
  query[(__bridge id)kSecValueData] = [@"secret" dataUsingEncoding:NSUTF8StringEncoding];
  SecItemAdd((__bridge CFDictionaryRef)query, nullptr);
}

} // namespace

TEST_CASE("A test launch keeps its folders, preferences and windows to itself and removes them as it ends") {
  auto pid = std::to_string(getpid());
  auto dir = std::filesystem::temp_directory_path() / ("ngn-test-launch-" + pid);
  const char *tmpdir = getenv("TMPDIR");
  std::string oldTmp = tmpdir != nullptr ? tmpdir : "";
  ngn::TestLaunch test{.stateDir = dir.string(), .runId = "unit-" + pid};
  NSWindow *window = nil;
  NSString *preferences = [NSSearchPathForDirectoriesInDomains(NSLibraryDirectory, NSUserDomainMask, YES).firstObject
      stringByAppendingPathComponent:@"Preferences"];
  auto stale = std::filesystem::path(preferences.UTF8String) / ("ngn-test-crashed-" + pid + ".defaults.plist");
  auto ownFile = std::filesystem::path(preferences.UTF8String) / (test.defaultsSuite() + ".plist");
  [@{} writeToFile:ns(stale.string()) atomically:YES];
  try {
    ngn::appkit::beginTestLaunch(test);
    CHECK_FALSE(std::filesystem::exists(stale));
    CHECK(std::filesystem::is_directory(dir / "Application Support"));
    CHECK(std::filesystem::is_directory(dir / "Caches"));
    CHECK(std::filesystem::is_directory(dir / "tmp"));
    CHECK(std::string(getenv("TMPDIR")) == test.temp() + "/");
    CHECK(ngn::appkit::cacheDirectory("com.example.app") == test.caches() + "/com.example.app");

    // Preferences go in the run's suite, not the standard defaults.
    NSUserDefaults *defaults = ngn::appkit::appDefaults();
    CHECK((defaults != NSUserDefaults.standardUserDefaults));
    [defaults setObject:@"1" forKey:@"ngn.test-launch.key"];
    CHECK_FALSE(has(NSUserDefaults.standardUserDefaults, @"ngn.test-launch.key"));
    CHECK(has(suite(test), @"ngn.test-launch.key"));
    [NSUserDefaults.standardUserDefaults setObject:@"frames" forKey:ns("NSSplitView Subview Frames " + test.keychainPrefix() + "main")];

    // Shown on screen without becoming key or activating the app.
    [NSApplication sharedApplication];
    window = [[NSWindow alloc] initWithContentRect:NSMakeRect(-10000, -10000, 100, 100)
                                         styleMask:NSWindowStyleMaskTitled
                                           backing:NSBackingStoreBuffered
                                             defer:NO];
    window.releasedWhenClosed = NO;
    ngn::appkit::showWindow(window);
    CHECK(window.visible);
    CHECK_FALSE(window.keyWindow);
    CHECK_FALSE(NSApp.active);

    int ended = 0;
    ngn::appkit::onTestLaunchEnd([&ended] { ended++; });
    ngn::appkit::endTestLaunch();
    ngn::appkit::endTestLaunch();
    CHECK(ended == 1);
    CHECK_FALSE(has(suite(test), @"ngn.test-launch.key"));
    CHECK_FALSE(std::filesystem::exists(ownFile));
    CHECK_FALSE(has(NSUserDefaults.standardUserDefaults, ns("NSSplitView Subview Frames " + test.keychainPrefix() + "main")));
  } catch (...) {
    FAIL("threw");
  }
  [window close];
  setenv("TMPDIR", oldTmp.c_str(), 1);
  std::filesystem::remove_all(dir);
  std::filesystem::remove(stale);
}

TEST_CASE("A test launch removes the Keychain items a crashed run left, and keeps its own and the app's") {
  auto pid = std::to_string(getpid());
  ngn::TestLaunch own{.stateDir = "/unused", .runId = "own-" + pid};
  std::string stale = "ngn-test-crashed-" + pid + ".com.example.app";
  std::string mine = own.keychainPrefix() + "com.example.app";
  std::string app = "ngn-unit-app-" + pid;
  add(stale);
  add(mine);
  add(app);
  CHECK(exists(stale));
  ngn::appkit::removeStaleTestItems(own);
  CHECK_FALSE(exists(stale));
  CHECK(exists(mine));
  CHECK(exists(app));
  for (const auto &service : {stale, mine, app}) {
    SecItemDelete((__bridge CFDictionaryRef)item(service));
  }
}
