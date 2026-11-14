#include "ngn/launch-settings.h"

#include <doctest/doctest.h>

#include <map>

namespace {

using Map = std::map<std::string, std::string>;

ngn::LaunchSources::Lookup from(Map values) {
  return [values = std::move(values)](const std::string &key) -> std::optional<std::string> {
    auto it = values.find(key);
    return it == values.end() ? std::nullopt : std::optional(it->second);
  };
}

const Map kPackagedPlist{
    {"NGNBundleFile", "main.jsbundle"},
    {"NGNModuleName", "app"},
    {"CFBundleName", "Notes"},
    {"CFBundleIdentifier", "com.example.notes"},
};

const Map kUpdatesEnv{
    {"NGN_UPDATES_URL", "https://evil.example/manifest"},
    {"NGN_RUNTIME_VERSION", "1"},
    {"NGN_UPDATES_CODE_SIGNING_CERTIFICATE", "-----BEGIN CERTIFICATE-----evil"},
    {"NGN_UPDATES_PLATFORM", "ios"},
    {"NGN_DESKTOP_CAPABILITIES", R"({"spawn":[{"program":"/bin/sh"}]})"},
};

} // namespace

TEST_CASE("A dev run takes its bundle, module, title, app id and capabilities from argv") {
  auto result = ngn::launchSettings({
      .args = {"http://localhost:8081/x.bundle", "--module", "app", "--title", "Notes", "--app-id", "dev.notes",
               "--capabilities", "{}"},
      .env = from({}),
      .plist = from({}),
  });
  REQUIRE(std::holds_alternative<ngn::LaunchSettings>(result));
  auto settings = std::get<ngn::LaunchSettings>(result);
  CHECK_FALSE(settings.packaged);
  CHECK(settings.bundle == "http://localhost:8081/x.bundle");
  CHECK(settings.module == "app");
  CHECK(settings.title == "Notes");
  CHECK(settings.appId == "dev.notes");
  CHECK(settings.capabilitiesJson == "{}");

  // The environment's capabilities when argv has none.
  auto env = std::get<ngn::LaunchSettings>(ngn::launchSettings({.args = {"/tmp/b.js"}, .env = from(kUpdatesEnv), .plist = from({})}));
  CHECK(env.capabilitiesJson == kUpdatesEnv.at("NGN_DESKTOP_CAPABILITIES"));

  CHECK(std::holds_alternative<std::string>(ngn::launchSettings({.args = {}, .env = from({}), .plist = from({})})));
  CHECK(std::holds_alternative<std::string>(
      ngn::launchSettings({.args = {"a.js", "b.js"}, .env = from({}), .plist = from({})})));
}

TEST_CASE("A packaged app runs what its Info.plist says, whatever argv and the environment say") {
  for (std::vector<std::string> args : std::vector<std::vector<std::string>>{
           {},
           {"/tmp/evil.js", "--module", "evil", "--app-id", "com.other.app", "--title", "Evil", "--capabilities",
            R"({"spawn":[{"program":"/bin/sh"}]})"},
           {"-psn_0_12345"},
       }) {
    CAPTURE(args.size());
    auto result = ngn::launchSettings(
        {.args = args, .env = from(kUpdatesEnv), .plist = from(kPackagedPlist), .resourcePath = "/Applications/Notes.app/Contents/Resources"});
    REQUIRE(std::holds_alternative<ngn::LaunchSettings>(result));
    auto settings = std::get<ngn::LaunchSettings>(result);
    CHECK(settings.packaged);
    CHECK(settings.bundle == "/Applications/Notes.app/Contents/Resources/main.jsbundle");
    CHECK(settings.module == "app");
    CHECK(settings.title == "Notes");
    CHECK(settings.appId == "com.example.notes");
    CHECK(settings.capabilitiesJson.empty());
  }
}

TEST_CASE("A packaged app's bundle file cannot name a path outside its Resources") {
  for (const char *file : {"../MacOS/evil.js", "/tmp/evil.js", ""}) {
    CAPTURE(file);
    Map plist = kPackagedPlist;
    plist["NGNBundleFile"] = file;
    auto result = ngn::launchSettings({.args = {}, .env = from({}), .plist = from(plist), .resourcePath = "/A.app/Contents/Resources"});
    CHECK(std::holds_alternative<std::string>(result));
  }
}

TEST_CASE("Updates settings come from the Info.plist, and from the environment only in a dev run") {
  auto packaged = std::get<ngn::LaunchSettings>(ngn::launchSettings(
      {.args = {}, .env = from(kUpdatesEnv), .plist = from(kPackagedPlist), .resourcePath = "/A.app/Contents/Resources"}));
  auto config = ngn::updatesConfigFrom(packaged, "/data", "/A.app/Contents/Resources/main.jsbundle");
  CHECK(config.url.empty());
  CHECK(config.runtimeVersion.empty());
  CHECK(config.certificatePem.empty());
  CHECK(config.platform == "macos");
  CHECK(config.directory == std::filesystem::path("/data/updates"));

  Map plist = kPackagedPlist;
  plist["NGNUpdatesURL"] = "https://updates.example/manifest";
  plist["NGNRuntimeVersion"] = "2";
  plist["NGNUpdatesCodeSigningKeyId"] = "k1";
  auto withUpdates = std::get<ngn::LaunchSettings>(ngn::launchSettings(
      {.args = {}, .env = from(kUpdatesEnv), .plist = from(plist), .resourcePath = "/A.app/Contents/Resources"}));
  config = ngn::updatesConfigFrom(withUpdates, "/data", "b");
  CHECK(config.url == "https://updates.example/manifest");
  CHECK(config.runtimeVersion == "2");
  CHECK(config.keyId == "k1");
  CHECK(config.certificatePem.empty());
  CHECK(config.embeddedBundle == "b");

  auto dev = std::get<ngn::LaunchSettings>(ngn::launchSettings({.args = {"/tmp/b.js"}, .env = from(kUpdatesEnv), .plist = from({})}));
  config = ngn::updatesConfigFrom(dev, "/data", "/tmp/b.js");
  CHECK(config.url == "https://evil.example/manifest");
  CHECK(config.platform == "ios");

  // No runtime version, no updates.
  auto noVersion = std::get<ngn::LaunchSettings>(ngn::launchSettings(
      {.args = {"/tmp/b.js"}, .env = from({{"NGN_UPDATES_URL", "https://x"}}), .plist = from({})}));
  CHECK(ngn::updatesConfigFrom(noVersion, "/data", "b").url.empty());
}
