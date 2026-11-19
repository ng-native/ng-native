#include "ngn/app-info.h"

namespace ngn {

namespace {

folly::dynamic orNull(const std::optional<std::string> &value) {
  return value && !value->empty() ? folly::dynamic(*value) : folly::dynamic(nullptr);
}

std::optional<std::string> firstOf(std::initializer_list<std::optional<std::string>> values) {
  for (const auto &value : values) {
    if (value && !value->empty()) {
      return value;
    }
  }
  return std::nullopt;
}

// expo-device's DeviceType.DESKTOP.
constexpr int kDesktop = 3;

} // namespace

BundleFacts bundleFactsOf(const std::function<std::optional<std::string>(const std::string &)> &plist) {
  if (!plist) {
    return {};
  }
  return {
      .version = plist("CFBundleShortVersionString"),
      .build = plist("CFBundleVersion"),
      .id = plist("CFBundleIdentifier"),
      .displayName = plist("CFBundleDisplayName"),
      .name = plist("CFBundleName"),
  };
}

std::map<std::string, std::string> osReleaseFields(const std::string &text) {
  std::map<std::string, std::string> fields;
  size_t start = 0;
  while (start < text.size()) {
    size_t end = text.find('\n', start);
    std::string line = text.substr(start, end == std::string::npos ? std::string::npos : end - start);
    start = end == std::string::npos ? text.size() : end + 1;
    auto equals = line.find('=');
    if (line.empty() || line[0] == '#' || equals == std::string::npos || equals == 0) {
      continue;
    }
    std::string key = line.substr(0, equals);
    std::string raw = line.substr(equals + 1);
    while (!raw.empty() && (raw.back() == ' ' || raw.back() == '\r' || raw.back() == '\t')) {
      raw.pop_back();
    }
    // Shell quoting: a quoted value loses its quotes, and inside double quotes a backslash escapes
    // the next character.
    std::string value;
    char quote = !raw.empty() && (raw[0] == '"' || raw[0] == '\'') ? raw[0] : 0;
    for (size_t i = quote ? 1 : 0; i < raw.size(); ++i) {
      char c = raw[i];
      if (quote && c == quote) {
        break;
      }
      if (quote != '\'' && c == '\\' && i + 1 < raw.size()) {
        c = raw[++i];
      }
      value += c;
    }
    fields[key] = value;
  }
  return fields;
}

std::shared_ptr<NativeModule> makeApplicationModule(BundleFacts bundle, std::string appId, std::string appName) {
  struct Application : NativeModule {
    Application(BundleFacts bundle, std::string appId, std::string appName) : NativeModule("NgNativeApplication") {
      auto id = orNull(firstOf({bundle.id, appId}));
      auto name = orNull(firstOf({bundle.displayName, bundle.name, appName}));
      auto version = orNull(bundle.version);
      auto build = orNull(bundle.build);
      property("nativeApplicationVersion", [version] { return version; });
      property("nativeBuildVersion", [build] { return build; });
      property("applicationId", [id] { return id; });
      property("applicationName", [name] { return name; });
    }
  };
  return std::make_shared<Application>(std::move(bundle), std::move(appId), std::move(appName));
}

std::shared_ptr<NativeModule> makeDeviceModule(MachineFacts machine, const HostOs &os) {
  struct Device : NativeModule {
    Device(const MachineFacts &machine, const HostOs &os) : NativeModule("NgNativeDevice") {
      auto maker = orNull(firstOf({os.deviceMaker, machine.manufacturer}));
      folly::dynamic architectures = folly::dynamic::array();
      for (const auto &architecture : machine.architectures) {
        architectures.push_back(architecture);
      }
      const std::map<std::string, folly::dynamic> values{
          {"brand", maker},
          {"manufacturer", maker},
          {"modelName", orNull(firstOf({machine.marketingName, machine.modelId}))},
          {"modelId", orNull(machine.modelId)},
          {"designName", nullptr},
          {"productName", nullptr},
          {"deviceYearClass", nullptr},
          {"osName", os.name},
          {"osVersion", orNull(machine.osVersion)},
          {"osBuildId", orNull(machine.osBuildId)},
          {"osInternalBuildId", orNull(machine.osBuildId)},
          {"deviceName", orNull(machine.deviceName)},
          {"totalMemory", machine.totalMemory > 0 ? folly::dynamic(static_cast<double>(machine.totalMemory)) : nullptr},
          {"supportedCpuArchitectures", architectures},
          {"isDevice", true},
          {"deviceType", kDesktop},
      };
      for (const auto &[key, value] : values) {
        property(key, [value] { return value; });
      }
    }
  };
  return std::make_shared<Device>(machine, os);
}

} // namespace ngn
