#include "ngn/launch-settings.h"

#include <doctest/doctest.h>
#include <folly/json.h>

#include <unistd.h>

#include <cstdlib>
#include <filesystem>
#include <fstream>
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

std::variant<ngn::LaunchSettings, std::string> launch(ngn::LaunchSources sources) {
  return ngn::launchSettings(std::move(sources), ngn::macOS());
}

} // namespace

TEST_CASE("A dev run takes its bundle, module, title, app id and capabilities from argv") {
  auto result = launch({
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
  CHECK(settings.initialUrl.empty());
  auto linked = std::get<ngn::LaunchSettings>(
      launch({.args = {"/tmp/b.js", "--url", "notes://note/7"}, .env = from({}), .plist = from({})}));
  CHECK(linked.initialUrl == "notes://note/7");

  // The environment's capabilities when argv has none.
  auto env = std::get<ngn::LaunchSettings>(launch({.args = {"/tmp/b.js"}, .env = from(kUpdatesEnv), .plist = from({})}));
  CHECK(env.capabilitiesJson == kUpdatesEnv.at("NGN_DESKTOP_CAPABILITIES"));

  CHECK(std::holds_alternative<std::string>(launch({.args = {}, .env = from({}), .plist = from({})})));
  CHECK(std::holds_alternative<std::string>(
      launch({.args = {"a.js", "b.js"}, .env = from({}), .plist = from({})})));
}

TEST_CASE("A packaged app runs what its Info.plist says, whatever argv and the environment say") {
  for (std::vector<std::string> args : std::vector<std::vector<std::string>>{
           {},
           {"/tmp/evil.js", "--module", "evil", "--app-id", "com.other.app", "--title", "Evil", "--capabilities",
            R"({"spawn":[{"program":"/bin/sh"}]})", "--url", "notes://evil"},
           {"-psn_0_12345"},
       }) {
    CAPTURE(args.size());
    auto result = launch(
        {.args = args, .env = from(kUpdatesEnv), .plist = from(kPackagedPlist), .resourcePath = "/Applications/Notes.app/Contents/Resources"});
    REQUIRE(std::holds_alternative<ngn::LaunchSettings>(result));
    auto settings = std::get<ngn::LaunchSettings>(result);
    CHECK(settings.packaged);
    CHECK(settings.bundle == "/Applications/Notes.app/Contents/Resources/main.jsbundle");
    CHECK(settings.module == "app");
    CHECK(settings.title == "Notes");
    CHECK(settings.appId == "com.example.notes");
    CHECK(settings.capabilitiesJson.empty());
    CHECK(settings.initialUrl.empty());
    CHECK_FALSE(settings.dbusService);
  }
}

TEST_CASE("A packaged app takes the links and files a Linux launcher opens it on, and the bus's service switch") {
  auto result = launch(
      {.args = {"--gapplication-service", "notes://note/7", "/home/ada/a.md", "file:///home/ada/b.md", "--title", "Evil", "evil",
                "{\"x\":1}"},
       .env = from({}),
       .plist = from(kPackagedPlist),
       .resourcePath = "/usr/lib/notes"});
  REQUIRE(std::holds_alternative<ngn::LaunchSettings>(result));
  auto settings = std::get<ngn::LaunchSettings>(result);
  CHECK(settings.dbusService);
  CHECK(settings.openArgs == std::vector<std::string>{"notes://note/7", "/home/ada/a.md", "file:///home/ada/b.md"});
  CHECK(settings.title == "Notes");
  CHECK(settings.initialUrl.empty());
  // A dev run takes the switch too, beside its bundle.
  auto dev = std::get<ngn::LaunchSettings>(launch({.args = {"/tmp/b.js", "--gapplication-service"}, .env = from({}), .plist = from({})}));
  CHECK(dev.dbusService);
  CHECK(dev.bundle == "/tmp/b.js");
}

TEST_CASE("The dev switches (input script, rotor and commit logs) work in a dev run and never in a packaged app") {
  const Map env{{"NGN_INPUT_SCRIPT", "/tmp/clicks.txt"}, {"NGN_LOG_ROTORS", "1"}, {"NGN_LOG_COMMITS", "1"}};
  auto dev = std::get<ngn::LaunchSettings>(launch({.args = {"/tmp/b.js"}, .env = from(env), .plist = from({})}));
  CHECK(dev.inputScript == "/tmp/clicks.txt");
  CHECK(dev.logRotors);
  CHECK(dev.logCommits);
  // Only "1" turns a log on, and nothing set leaves them all off.
  auto other = std::get<ngn::LaunchSettings>(launch(
      {.args = {"/tmp/b.js"}, .env = from({{"NGN_LOG_ROTORS", "yes"}, {"NGN_LOG_COMMITS", "0"}}), .plist = from({})}));
  CHECK_FALSE(other.logRotors);
  CHECK_FALSE(other.logCommits);
  CHECK(other.inputScript.empty());

  auto packaged = std::get<ngn::LaunchSettings>(launch(
      {.args = {}, .env = from(env), .plist = from(kPackagedPlist), .resourcePath = "/Applications/Notes.app/Contents/Resources"}));
  CHECK(packaged.inputScript.empty());
  CHECK_FALSE(packaged.logRotors);
  CHECK_FALSE(packaged.logCommits);
}

TEST_CASE("A packaged app's bundle file cannot name a path outside its Resources") {
  for (const char *file : {"../MacOS/evil.js", "/tmp/evil.js", ""}) {
    CAPTURE(file);
    Map plist = kPackagedPlist;
    plist["NGNBundleFile"] = file;
    auto result = launch({.args = {}, .env = from({}), .plist = from(plist), .resourcePath = "/A.app/Contents/Resources"});
    CHECK(std::holds_alternative<std::string>(result));
  }
}

TEST_CASE("Updates settings come from the Info.plist, and from the environment only in a dev run") {
  auto packaged = std::get<ngn::LaunchSettings>(launch(
      {.args = {}, .env = from(kUpdatesEnv), .plist = from(kPackagedPlist), .resourcePath = "/A.app/Contents/Resources"}));
  auto config = ngn::updatesConfigFrom(packaged, ngn::macOS(), "/data", "/A.app/Contents/Resources/main.jsbundle");
  CHECK(config.url.empty());
  CHECK(config.runtimeVersion.empty());
  CHECK(config.certificatePem.empty());
  CHECK(config.platform == "macos");
  CHECK(config.directory == std::filesystem::path("/data/updates"));

  Map plist = kPackagedPlist;
  plist["NGNUpdatesURL"] = "https://updates.example/manifest";
  plist["NGNRuntimeVersion"] = "2";
  plist["NGNUpdatesCodeSigningKeyId"] = "k1";
  auto withUpdates = std::get<ngn::LaunchSettings>(launch(
      {.args = {}, .env = from(kUpdatesEnv), .plist = from(plist), .resourcePath = "/A.app/Contents/Resources"}));
  config = ngn::updatesConfigFrom(withUpdates, ngn::macOS(), "/data", "b");
  CHECK(config.url == "https://updates.example/manifest");
  CHECK(config.runtimeVersion == "2");
  CHECK(config.keyId == "k1");
  CHECK(config.certificatePem.empty());
  CHECK(config.embeddedBundle == "b");

  auto dev = std::get<ngn::LaunchSettings>(launch({.args = {"/tmp/b.js"}, .env = from(kUpdatesEnv), .plist = from({})}));
  config = ngn::updatesConfigFrom(dev, ngn::macOS(), "/data", "/tmp/b.js");
  CHECK(config.url == "https://evil.example/manifest");
  CHECK(config.platform == "ios");

  // No runtime version, no updates.
  auto noVersion = std::get<ngn::LaunchSettings>(launch(
      {.args = {"/tmp/b.js"}, .env = from({{"NGN_UPDATES_URL", "https://x"}}), .plist = from({})}));
  CHECK(ngn::updatesConfigFrom(noVersion, ngn::macOS(), "/data", "b").url.empty());
}

TEST_CASE("A test launch keeps its state under NGN_STATE_DIR and names the rest by NGN_RUN_ID") {
  const Map env{
      {"NGN_TESTS", "1"},
      {"NGN_STATE_DIR", "/tmp/state-1/"},
      {"NGN_RUN_ID", "6f1c-AB12"},
      {"NGN_TESTS_FAKE_SYSTEM_UI", "1"},
  };
  auto settings = std::get<ngn::LaunchSettings>(launch({.args = {"/tmp/b.js"}, .env = from(env), .plist = from({})}));
  REQUIRE(settings.test.has_value());
  CHECK(settings.test->stateDir == "/tmp/state-1");
  CHECK(settings.test->applicationSupport() == "/tmp/state-1/Application Support");
  CHECK(settings.test->caches() == "/tmp/state-1/Caches");
  CHECK(settings.test->temp() == "/tmp/state-1/tmp");
  CHECK(settings.test->keychainPrefix() == "ngn-test-6f1c-AB12.");
  CHECK(settings.test->defaultsSuite() == "ngn-test-6f1c-AB12.defaults");
  CHECK(settings.test->fakeSystemUI);
  CHECK(settings.noPrompts);

  // Real system UI when the run asks for it.
  Map real = env;
  real.erase("NGN_TESTS_FAKE_SYSTEM_UI");
  auto withUi = std::get<ngn::LaunchSettings>(launch({.args = {"/tmp/b.js"}, .env = from(real), .plist = from({})}));
  CHECK_FALSE(withUi.test->fakeSystemUI);
  CHECK_FALSE(withUi.noPrompts);

  // Not a test launch without NGN_TESTS=1, whatever else is set.
  for (const char *value : {"0", "", "true"}) {
    Map off = env;
    off["NGN_TESTS"] = value;
    auto plain = std::get<ngn::LaunchSettings>(launch({.args = {"/tmp/b.js"}, .env = from(off), .plist = from({})}));
    CHECK_FALSE(plain.test.has_value());
    CHECK_FALSE(plain.noPrompts);
  }
  auto prompts = std::get<ngn::LaunchSettings>(
      launch({.args = {"/tmp/b.js"}, .env = from({{"NGN_NO_PROMPTS", "1"}}), .plist = from({})}));
  CHECK(prompts.noPrompts);
  CHECK_FALSE(prompts.test.has_value());
}

TEST_CASE("A test launch with no usable state directory or run id does not start") {
  for (Map env : std::vector<Map>{
           {{"NGN_TESTS", "1"}, {"NGN_RUN_ID", "abc"}},
           {{"NGN_TESTS", "1"}, {"NGN_STATE_DIR", "relative"}, {"NGN_RUN_ID", "abc"}},
           {{"NGN_TESTS", "1"}, {"NGN_STATE_DIR", "/tmp/s"}},
           {{"NGN_TESTS", "1"}, {"NGN_STATE_DIR", "/tmp/s"}, {"NGN_RUN_ID", "a/../b"}},
           {{"NGN_TESTS", "1"}, {"NGN_STATE_DIR", "/tmp/s"}, {"NGN_RUN_ID", "a b"}},
       }) {
    CAPTURE(env.size());
    auto result = launch({.args = {"/tmp/b.js"}, .env = from(env), .plist = from({})});
    REQUIRE(std::holds_alternative<std::string>(result));
    CHECK(std::get<std::string>(result).find("NGN_TESTS=1") != std::string::npos);
  }
}

TEST_CASE("A packaged app is never a test launch") {
  const Map env{{"NGN_TESTS", "1"}, {"NGN_STATE_DIR", "/tmp/s"}, {"NGN_RUN_ID", "abc"}, {"NGN_TESTS_FAKE_SYSTEM_UI", "1"}};
  auto settings = std::get<ngn::LaunchSettings>(launch(
      {.args = {}, .env = from(env), .plist = from(kPackagedPlist), .resourcePath = "/A.app/Contents/Resources"}));
  CHECK_FALSE(settings.test.has_value());
  CHECK_FALSE(settings.noPrompts);
}

TEST_CASE("Another test launch's Keychain services are stale, this one's and the app's own are not") {
  ngn::TestLaunch own{.stateDir = "/s", .runId = "run-1"};
  CHECK(ngn::isStaleTestService("ngn-test-run-0.com.example", own));
  CHECK(ngn::isStaleTestService("ngn-test-run-10.com.example", own));
  CHECK_FALSE(ngn::isStaleTestService("ngn-test-run-1.com.example", own));
  CHECK_FALSE(ngn::isStaleTestService("com.example", own));
}

namespace {

// A folder of its own for one test, removed as the test ends however it ends.
struct Folder {
  std::filesystem::path path = std::filesystem::temp_directory_path() /
      ("ngn-metadata-" + std::to_string(getpid()) + "-" + std::to_string(rand()));
  Folder() { std::filesystem::create_directories(path); }
  ~Folder() { std::filesystem::remove_all(path); }
  void write(const std::string &text) const { std::ofstream(path / "metadata.json") << text; }
};

} // namespace

TEST_CASE("A Linux package's metadata.json makes it a packaged app, as a macOS app's Info.plist does") {
  Folder folder;
  // What bin/package-linux.mjs writes.
  folder.write(R"({
    "CFBundleName": "Notes",
    "CFBundleIdentifier": "com.example.notes",
    "CFBundleShortVersionString": "1.0.0",
    "NGNBundleFile": "main.hbc",
    "NGNModuleName": "main",
    "NGNDistribution": "deb",
    "NGNCapabilities": {"spawn": [{"program": "/usr/bin/git"}]},
    "NGNUpdatesURL": "https://updates.example/manifest",
    "NGNRuntimeVersion": "1"
  })");
  auto metadata = ngn::packagedMetadata(folder.path.string());
  REQUIRE(std::holds_alternative<ngn::LaunchSources::Lookup>(metadata));
  auto lookup = std::get<ngn::LaunchSources::Lookup>(metadata);
  REQUIRE(lookup);
  CHECK(lookup("NGNDistribution") == "deb");
  CHECK_FALSE(lookup("SUFeedURL"));

  // argv and the environment are ignored, as for a macOS app.
  auto result = ngn::launchSettings(
      {.args = {"/tmp/evil.js", "--capabilities", "{}"}, .env = from(kUpdatesEnv), .plist = lookup, .resourcePath = folder.path.string()},
      ngn::linuxOs());
  REQUIRE(std::holds_alternative<ngn::LaunchSettings>(result));
  auto settings = std::get<ngn::LaunchSettings>(result);
  CHECK(settings.packaged);
  CHECK(settings.bundle == (folder.path / "main.hbc").string());
  CHECK(settings.module == "main");
  CHECK(settings.title == "Notes");
  CHECK(settings.appId == "com.example.notes");
  CHECK(folly::parseJson(settings.capabilitiesJson) == folly::parseJson(R"({"spawn": [{"program": "/usr/bin/git"}]})"));
  auto config = ngn::updatesConfigFrom(settings, ngn::linuxOs(), "/data", settings.bundle);
  CHECK(config.url == "https://updates.example/manifest");
  CHECK(config.platform == "linux");
}

TEST_CASE("A host with no metadata.json beside it is a dev run, and a broken one does not start") {
  Folder folder;
  auto none = ngn::packagedMetadata(folder.path.string());
  REQUIRE(std::holds_alternative<ngn::LaunchSources::Lookup>(none));
  CHECK_FALSE(std::get<ngn::LaunchSources::Lookup>(none));
  auto dev = ngn::launchSettings(
      {.args = {"/tmp/b.js"}, .env = from({}), .plist = std::get<ngn::LaunchSources::Lookup>(none)}, ngn::linuxOs());
  REQUIRE(std::holds_alternative<ngn::LaunchSettings>(dev));
  CHECK_FALSE(std::get<ngn::LaunchSettings>(dev).packaged);

  for (const char *text : {"{\"NGNBundleFile\": ", "[\"main.hbc\"]"}) {
    CAPTURE(text);
    folder.write(text);
    CHECK(std::holds_alternative<std::string>(ngn::packagedMetadata(folder.path.string())));
  }

  // One that is there but cannot be opened (a link to itself, which root cannot open either) does
  // not start, rather than run as a dev build from argv.
  std::filesystem::remove(folder.path / "metadata.json");
  std::filesystem::create_symlink("metadata.json", folder.path / "metadata.json");
  auto unreadable = ngn::packagedMetadata(folder.path.string());
  REQUIRE(std::holds_alternative<std::string>(unreadable));
  CHECK(std::get<std::string>(unreadable).find("cannot be read") != std::string::npos);
}
