// machineFacts and mainBundleFacts (app-info.mm) on the Mac running the tests.
#include "../app-info.h"

#include <doctest/doctest.h>

#import <Foundation/Foundation.h>

TEST_CASE("machineFacts reads this Mac's model, OS and memory") {
  auto facts = ngn::appkit::machineFacts();
  CHECK(facts.modelId.find("Mac") != std::string::npos);
  NSOperatingSystemVersion os = NSProcessInfo.processInfo.operatingSystemVersion;
  CHECK(facts.osVersion.rfind(std::to_string(os.majorVersion) + ".", 0) == 0);
  CHECK_FALSE(facts.osBuildId.empty());
  CHECK(facts.totalMemory == NSProcessInfo.processInfo.physicalMemory);
  REQUIRE(facts.architectures.size() == 1);
#if defined(__arm64__)
  CHECK(facts.architectures[0] == "arm64");
  // Apple silicon names its model in the device tree.
  CHECK(facts.marketingName.has_value());
#endif
  auto module = ngn::makeDeviceModule(facts);
  CHECK(module->property("modelName").isString());
}

TEST_CASE("mainBundleFacts of a binary with no Info.plist is empty, and the app's own stand in") {
  // The test binary, like a dev run's host, is a bare executable.
  auto bundle = ngn::appkit::mainBundleFacts();
  CHECK_FALSE(bundle.version);
  auto module = ngn::makeApplicationModule(bundle, "com.example.tests", "Tests");
  CHECK(module->property("applicationName") == folly::dynamic("Tests"));
}
