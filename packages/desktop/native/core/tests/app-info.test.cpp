#include "ngn/app-info.h"
#include "ngn/host-os.h"

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
  }, ngn::macOS());
  CHECK(module->property("brand") == dynamic("Apple"));
  CHECK(module->property("manufacturer") == dynamic("Apple"));
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
  auto module = ngn::makeDeviceModule({.modelId = "Mac14,2", .osVersion = "15.0"}, ngn::macOS());
  CHECK(module->property("modelName") == dynamic("Mac14,2"));
  CHECK(module->property("deviceName") == dynamic(nullptr));
  CHECK(module->property("totalMemory") == dynamic(nullptr));
}

TEST_CASE("NgNativeDevice on Linux is the machine's maker's, with the distribution's version") {
  auto module = ngn::makeDeviceModule({
      .manufacturer = "LENOVO",
      .modelId = "20XW0055UK",
      .osVersion = "9.4",
      .osBuildId = "5.14.0-427.el9.x86_64",
      .deviceName = "desk",
      .totalMemory = 8ull << 30,
      .architectures = {"x86_64"},
  }, ngn::linuxOs());
  CHECK(module->property("brand") == dynamic("LENOVO"));
  CHECK(module->property("manufacturer") == dynamic("LENOVO"));
  CHECK(module->property("modelName") == dynamic("20XW0055UK"));
  CHECK(module->property("osName") == dynamic("Linux"));
  CHECK(module->property("osVersion") == dynamic("9.4"));
  CHECK(module->property("osBuildId") == dynamic("5.14.0-427.el9.x86_64"));
  CHECK(module->property("deviceType") == dynamic(3));
  // A virtual machine's firmware may name no maker: the brand is unknown, never Apple.
  auto unnamed = ngn::makeDeviceModule({.modelId = "", .osVersion = "9.4"}, ngn::linuxOs());
  CHECK(unnamed->property("brand") == dynamic(nullptr));
  CHECK(unnamed->property("modelName") == dynamic(nullptr));
}

TEST_CASE("bundleFactsOf reads a Linux package's metadata.json keys") {
  std::map<std::string, std::string> metadata{
      {"CFBundleShortVersionString", "1.4.0"}, {"CFBundleVersion", "17"}, {"CFBundleIdentifier", "dev.example.notes"}, {"CFBundleName", "Notes"}};
  auto facts = ngn::bundleFactsOf([&](const std::string &key) -> std::optional<std::string> {
    auto it = metadata.find(key);
    return it == metadata.end() ? std::nullopt : std::optional<std::string>(it->second);
  });
  auto module = ngn::makeApplicationModule(facts, "dev-id", "Dev");
  CHECK(module->property("nativeApplicationVersion") == dynamic("1.4.0"));
  CHECK(module->property("nativeBuildVersion") == dynamic("17"));
  CHECK(module->property("applicationId") == dynamic("dev.example.notes"));
  CHECK(module->property("applicationName") == dynamic("Notes"));
  // A dev run has no metadata: the app's own id and name stand in.
  auto dev = ngn::makeApplicationModule(ngn::bundleFactsOf({}), "dev-id", "Dev");
  CHECK(dev->property("applicationId") == dynamic("dev-id"));
  CHECK(dev->property("nativeApplicationVersion") == dynamic(nullptr));
}

TEST_CASE("osReleaseFields unquotes os-release's values") {
  auto fields = ngn::osReleaseFields(
      "NAME=\"AlmaLinux\"\n# a comment\nVERSION_ID='9.4'\nID=almalinux\nPRETTY_NAME=\"Alma \\\"Seafoam\\\" Ocelot\"\r\nnot a field\n=x\n");
  CHECK(fields["NAME"] == "AlmaLinux");
  CHECK(fields["VERSION_ID"] == "9.4");
  CHECK(fields["ID"] == "almalinux");
  CHECK(fields["PRETTY_NAME"] == "Alma \"Seafoam\" Ocelot");
  CHECK(fields.size() == 4);
}
