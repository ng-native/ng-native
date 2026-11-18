#include "ngn/launch-settings.h"

#include <folly/json.h>

#include <cctype>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>

namespace ngn {

namespace {

std::string usage(const HostOs &os) {
  return "usage: " + os.program +
      " <bundle> [--module <name>] [--title <title>] [--app-id <id>] [--capabilities <json>] [--url <link>]";
}

bool is(const LaunchSources &sources, const char *name, const char *value) {
  auto found = sources.env ? sources.env(name) : std::nullopt;
  return found && *found == value;
}

// A test launch from the environment, nothing when NGN_TESTS is not 1, or why it is unusable.
std::variant<std::optional<TestLaunch>, std::string> testLaunch(const LaunchSources &sources) {
  if (!is(sources, "NGN_TESTS", "1")) {
    return std::optional<TestLaunch>();
  }
  auto dir = sources.env("NGN_STATE_DIR").value_or("");
  auto runId = sources.env("NGN_RUN_ID").value_or("");
  if (dir.empty() || dir.front() != '/') {
    return std::string("NGN_TESTS=1 needs NGN_STATE_DIR, an absolute path: \"") + dir + "\"";
  }
  bool plain = !runId.empty() && runId.size() <= 64;
  for (char c : runId) {
    plain = plain && (std::isalnum(static_cast<unsigned char>(c)) || c == '-');
  }
  if (!plain) {
    return std::string("NGN_TESTS=1 needs NGN_RUN_ID, letters, digits and dashes: \"") + runId + "\"";
  }
  while (dir.size() > 1 && dir.back() == '/') {
    dir.pop_back();
  }
  return std::optional<TestLaunch>(
      TestLaunch{.stateDir = dir, .runId = runId, .fakeSystemUI = is(sources, "NGN_TESTS_FAKE_SYSTEM_UI", "1")});
}

} // namespace

bool isStaleTestService(const std::string &service, const TestLaunch &own) {
  return service.starts_with("ngn-test-") && !service.starts_with(own.keychainPrefix());
}

std::string LaunchSettings::setting(const std::string &plistKey, const std::string &envName) const {
  if (auto value = plist ? plist(plistKey) : std::nullopt) {
    return *value;
  }
  if (!packaged && env) {
    if (auto value = env(envName)) {
      return *value;
    }
  }
  return "";
}

std::variant<LaunchSettings, std::string> launchSettings(LaunchSources sources, const HostOs &os) {
  LaunchSettings settings;
  settings.env = sources.env;
  settings.plist = sources.plist;
  auto plist = [&](const char *key) { return sources.plist ? sources.plist(key) : std::nullopt; };
  // Only ever takes a prompt away, so a packaged app reads it too.
  settings.noPrompts = is(sources, "NGN_NO_PROMPTS", "1");

  if (auto file = plist("NGNBundleFile")) {
    // Packaged: argv and the environment are never read.
    std::filesystem::path relative(*file);
    bool inside = !file->empty() && relative.is_relative();
    for (const auto &part : relative) {
      inside = inside && part != "..";
    }
    if (!inside) {
      return std::string("NGNBundleFile must name a file inside the app's Resources: ") + *file;
    }
    settings.packaged = true;
    settings.bundle = (std::filesystem::path(sources.resourcePath) / relative).string();
    settings.module = plist("NGNModuleName").value_or("main");
    settings.title = plist("CFBundleName").value_or(settings.title);
    settings.appId = plist("CFBundleIdentifier").value_or("");
    settings.capabilitiesJson = plist("NGNCapabilities").value_or("");
    return settings;
  }

  auto test = testLaunch(sources);
  if (auto *problem = std::get_if<std::string>(&test)) {
    return *problem;
  }
  settings.test = std::get<std::optional<TestLaunch>>(test);
  settings.noPrompts = settings.noPrompts || (settings.test && settings.test->fakeSystemUI);
  settings.inputScript = sources.env ? sources.env("NGN_INPUT_SCRIPT").value_or("") : "";
  settings.logRotors = is(sources, "NGN_LOG_ROTORS", "1");
  settings.logCommits = is(sources, "NGN_LOG_COMMITS", "1");
  if (auto capabilities = sources.env ? sources.env("NGN_DESKTOP_CAPABILITIES") : std::nullopt) {
    settings.capabilitiesJson = *capabilities;
  }
  const auto &args = sources.args;
  for (size_t i = 0; i < args.size(); i++) {
    const auto &arg = args[i];
    bool hasValue = i + 1 < args.size();
    if (arg == "--module" && hasValue) {
      settings.module = args[++i];
    } else if (arg == "--app-id" && hasValue) {
      settings.appId = args[++i];
    } else if (arg == "--capabilities" && hasValue) {
      settings.capabilitiesJson = args[++i];
    } else if (arg == "--url" && hasValue) {
      settings.initialUrl = args[++i];
    } else if (arg == "--title" && hasValue) {
      settings.title = args[++i];
    } else if (settings.bundle.empty() && !arg.starts_with("--")) {
      settings.bundle = arg;
    } else {
      return usage(os);
    }
  }
  if (settings.bundle.empty()) {
    return usage(os);
  }
  return settings;
}

std::variant<LaunchSources::Lookup, std::string> packagedMetadata(const std::string &folder) {
  auto path = std::filesystem::path(folder) / "metadata.json";
  // Only a file that is not there makes a dev run: one that is there and cannot be read is a broken
  // package, which must not fall back to argv and the environment.
  std::error_code error;
  bool there = std::filesystem::exists(path, error);
  if (error) {
    return path.string() + " cannot be read: " + error.message();
  }
  if (!there) {
    return LaunchSources::Lookup();
  }
  std::ifstream file(path);
  if (!file) {
    return path.string() + " cannot be read";
  }
  std::stringstream text;
  text << file.rdbuf();
  folly::dynamic metadata;
  try {
    metadata = folly::parseJson(text.str());
  } catch (const std::exception &error) {
    return path.string() + " is not JSON: " + error.what();
  }
  if (!metadata.isObject()) {
    return path.string() + " is not a JSON object";
  }
  return LaunchSources::Lookup([metadata = std::move(metadata)](const std::string &key) -> std::optional<std::string> {
    auto it = metadata.find(key);
    if (it == metadata.items().end() || it->second.isNull()) {
      return std::nullopt;
    }
    return it->second.isString() ? it->second.getString() : folly::toJson(it->second);
  });
}

UpdatesConfig updatesConfigFrom(
    const LaunchSettings &settings, const HostOs &os, const std::string &appData, const std::string &embeddedBundle) {
  UpdatesConfig config{
      .url = settings.setting("NGNUpdatesURL", "NGN_UPDATES_URL"),
      .runtimeVersion = settings.setting("NGNRuntimeVersion", "NGN_RUNTIME_VERSION"),
      .platform = os.id,
      .certificatePem = settings.setting("NGNUpdatesCodeSigningCertificate", "NGN_UPDATES_CODE_SIGNING_CERTIFICATE"),
      .directory = std::filesystem::path(appData) / "updates",
      .embeddedBundle = embeddedBundle,
  };
  if (auto platform = settings.setting("NGNUpdatesPlatform", "NGN_UPDATES_PLATFORM"); !platform.empty()) {
    config.platform = platform;
  }
  if (auto keyId = settings.setting("NGNUpdatesCodeSigningKeyId", "NGN_UPDATES_CODE_SIGNING_KEY_ID"); !keyId.empty()) {
    config.keyId = keyId;
  }
  if (auto alg = settings.setting("NGNUpdatesCodeSigningAlg", "NGN_UPDATES_CODE_SIGNING_ALG"); !alg.empty()) {
    config.algorithm = alg;
  }
  // A server needs a runtime version to match against; without one, updates are off.
  if (config.runtimeVersion.empty()) {
    config.url.clear();
  }
  return config;
}

} // namespace ngn
