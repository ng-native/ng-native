#include "ngn/launch-settings.h"

#include <filesystem>

namespace ngn {

namespace {

const char *kUsage =
    "usage: ngn-macos <bundle> [--module <name>] [--title <title>] [--app-id <id>] [--capabilities <json>]";

} // namespace

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

std::variant<LaunchSettings, std::string> launchSettings(LaunchSources sources) {
  LaunchSettings settings;
  settings.env = sources.env;
  settings.plist = sources.plist;
  auto plist = [&](const char *key) { return sources.plist ? sources.plist(key) : std::nullopt; };

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
    return settings;
  }

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
    } else if (arg == "--title" && hasValue) {
      settings.title = args[++i];
    } else if (settings.bundle.empty() && !arg.starts_with("--")) {
      settings.bundle = arg;
    } else {
      return std::string(kUsage);
    }
  }
  if (settings.bundle.empty()) {
    return std::string(kUsage);
  }
  return settings;
}

UpdatesConfig updatesConfigFrom(const LaunchSettings &settings, const std::string &appData, const std::string &embeddedBundle) {
  UpdatesConfig config{
      .url = settings.setting("NGNUpdatesURL", "NGN_UPDATES_URL"),
      .runtimeVersion = settings.setting("NGNRuntimeVersion", "NGN_RUNTIME_VERSION"),
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
