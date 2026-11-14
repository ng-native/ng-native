#include "ngn/app-info.h"

#include <doctest/doctest.h>

using folly::dynamic;

TEST_CASE("NgNativeApplication answers the bundle's Info.plist") {
  auto module = ngn::makeApplicationModule(
      {.version = "1.2.0", .build = "42", .id = "com.example.notes", .displayName = "Notes", .name = "notes"},
      "notes-dev",
      "Notes Dev");
  CHECK(module->property("nativeApplicationVersion") == dynamic("1.2.0"));
  CHECK(module->property("nativeBuildVersion") == dynamic("42"));
  CHECK(module->property("applicationId") == dynamic("com.example.notes"));
  CHECK(module->property("applicationName") == dynamic("Notes"));
}

TEST_CASE("NgNativeApplication takes the bundle name without a display name, and the app's own in a dev run") {
  auto named = ngn::makeApplicationModule({.id = "com.example.notes", .displayName = "", .name = "notes"}, "x", "X");
  CHECK(named->property("applicationName") == dynamic("notes"));
  auto dev = ngn::makeApplicationModule({}, "com.example.dev", "Dev App");
  CHECK(dev->property("applicationId") == dynamic("com.example.dev"));
  CHECK(dev->property("applicationName") == dynamic("Dev App"));
  CHECK(dev->property("nativeApplicationVersion") == dynamic(nullptr));
  CHECK(dev->property("nativeBuildVersion") == dynamic(nullptr));
  auto nothing = ngn::makeApplicationModule({}, "", "");
  CHECK(nothing->property("applicationId") == dynamic(nullptr));
}

TEST_CASE("NgNativeDevice is a physical desktop Mac") {
  auto module = ngn::makeDeviceModule({
      .marketingName = "MacBook Pro (14-inch, Nov 2023)",
      .modelId = "Mac15,3",
      .osVersion = "26.1",
      .osBuildId = "25B78",
      .deviceName = "Studio",
      .totalMemory = 17179869184ull,
      .architectures = {"arm64"},
  });
  CHECK(module->property("brand") == dynamic("Apple"));
  CHECK(module->property("modelName") == dynamic("MacBook Pro (14-inch, Nov 2023)"));
  CHECK(module->property("modelId") == dynamic("Mac15,3"));
  CHECK(module->property("osName") == dynamic("macOS"));
  CHECK(module->property("osVersion") == dynamic("26.1"));
  CHECK(module->property("osBuildId") == dynamic("25B78"));
  CHECK(module->property("deviceName") == dynamic("Studio"));
  CHECK(module->property("totalMemory") == dynamic(17179869184.0));
  CHECK(module->property("supportedCpuArchitectures") == dynamic::array("arm64"));
  CHECK(module->property("isDevice") == dynamic(true));
  CHECK(module->property("deviceType") == dynamic(3));
}

TEST_CASE("NgNativeDevice names the model by its identifier when the Mac gives no marketing name") {
  auto module = ngn::makeDeviceModule({.modelId = "Mac14,2", .osVersion = "15.0"});
  CHECK(module->property("modelName") == dynamic("Mac14,2"));
  CHECK(module->property("deviceName") == dynamic(nullptr));
  CHECK(module->property("totalMemory") == dynamic(nullptr));
}
