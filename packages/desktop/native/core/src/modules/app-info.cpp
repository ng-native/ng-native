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

std::shared_ptr<NativeModule> makeDeviceModule(MachineFacts machine) {
  struct Device : NativeModule {
    explicit Device(const MachineFacts &machine) : NativeModule("NgNativeDevice") {
      folly::dynamic architectures = folly::dynamic::array();
      for (const auto &architecture : machine.architectures) {
        architectures.push_back(architecture);
      }
      const std::map<std::string, folly::dynamic> values{
          {"brand", "Apple"},
          {"manufacturer", "Apple"},
          {"modelName", orNull(firstOf({machine.marketingName, machine.modelId}))},
          {"modelId", orNull(machine.modelId)},
          {"designName", nullptr},
          {"productName", nullptr},
          {"deviceYearClass", nullptr},
          {"osName", "macOS"},
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
  return std::make_shared<Device>(machine);
}

} // namespace ngn
