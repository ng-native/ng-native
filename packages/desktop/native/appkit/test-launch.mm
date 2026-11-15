#import "test-launch.h"

#include <cstdlib>
#include <filesystem>
#include <vector>

namespace ngn::appkit {

namespace {

std::optional<TestLaunch> &current() {
  static std::optional<TestLaunch> test;
  return test;
}

std::vector<std::function<void()>> &cleanups() {
  static std::vector<std::function<void()>> list;
  return list;
}

NSString *ns(const std::string &s) {
  return [NSString stringWithUTF8String:s.c_str()];
}

// The file a defaults suite is kept in. Removing the suite's domain leaves it behind, empty.
std::filesystem::path suiteFile(const std::string &suite) {
  NSString *library = NSSearchPathForDirectoriesInDomains(NSLibraryDirectory, NSUserDomainMask, YES).firstObject;
  return std::filesystem::path(library.UTF8String) / "Preferences" / (suite + ".plist");
}

// The suites of runs that ended without removing theirs (a crash): files only, never read.
void removeStaleSuites(const TestLaunch &own) {
  std::error_code ignored;
  auto folder = suiteFile(own.defaultsSuite()).parent_path();
  for (const auto &entry : std::filesystem::directory_iterator(folder, ignored)) {
    auto name = entry.path().filename().string();
    if (name.ends_with(".defaults.plist") && isStaleTestService(name, own)) {
      std::filesystem::remove(entry.path(), ignored);
    }
  }
}

} // namespace

void beginTestLaunch(const std::optional<TestLaunch> &test) {
  current() = test;
  if (!test) {
    return;
  }
  std::error_code ignored;
  for (const auto &dir : {test->applicationSupport(), test->caches(), test->temp()}) {
    std::filesystem::create_directories(dir, ignored);
  }
  // What C++ and the programs the app runs take as the temporary directory. Foundation's
  // NSTemporaryDirectory ignores it, so FileSystem is given the folder itself.
  setenv("TMPDIR", (test->temp() + "/").c_str(), 1);
  removeStaleSuites(*test);
}

const std::optional<TestLaunch> &testLaunch() {
  return current();
}

NSUserDefaults *appDefaults() {
  static NSUserDefaults *defaults = current() ? [[NSUserDefaults alloc] initWithSuiteName:ns(current()->defaultsSuite())]
                                              : NSUserDefaults.standardUserDefaults;
  return defaults;
}

void showWindow(NSWindow *window) {
  if (current()) {
    [window orderFrontRegardless];
  } else {
    [window makeKeyAndOrderFront:nil];
  }
}

void activateWith(NSWindow *window) {
  if (current() && NSApp.activationPolicy != NSApplicationActivationPolicyRegular) {
    NSApp.activationPolicy = NSApplicationActivationPolicyRegular;
  }
  [window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}

void onTestLaunchEnd(std::function<void()> cleanup) {
  if (current()) {
    cleanups().push_back(std::move(cleanup));
  }
}

void endTestLaunch() {
  static bool ended = false;
  if (!current() || ended) {
    return;
  }
  ended = true;
  for (const auto &cleanup : cleanups()) {
    cleanup();
  }
  [appDefaults() removePersistentDomainForName:ns(current()->defaultsSuite())];
  CFPreferencesAppSynchronize((__bridge CFStringRef)ns(current()->defaultsSuite()));
  std::error_code ignored;
  std::filesystem::remove(suiteFile(current()->defaultsSuite()), ignored);
  // NSSplitView autosaves into the standard defaults, under names the run prefixed.
  NSUserDefaults *standard = NSUserDefaults.standardUserDefaults;
  NSString *own = ns(current()->keychainPrefix());
  for (NSString *key in standard.dictionaryRepresentation.allKeys) {
    if ([key containsString:own]) {
      [standard removeObjectForKey:key];
    }
  }
}

} // namespace ngn::appkit
