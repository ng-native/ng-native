// NgNativeApplication and NgNativeDevice: the constants @ng-native/expo's AppInfo reads off
// expo-application and expo-device, as properties.
//
// - NgNativeApplication: nativeApplicationVersion (CFBundleShortVersionString),
//   nativeBuildVersion (CFBundleVersion), applicationId (CFBundleIdentifier) and applicationName
//   (CFBundleDisplayName, else CFBundleName). A dev run's binary has no bundle: its id and name are
//   the app's own (app.json's), and its versions null.
// - NgNativeDevice: brand and manufacturer "Apple", modelName (the Mac's marketing name, else its
//   model identifier), modelId ("Mac15,3"), osName "macOS", osVersion, osBuildId, deviceName,
//   totalMemory, supportedCpuArchitectures, isDevice true (a Mac is never a simulator) and
//   deviceType 3, expo-device's DESKTOP.
#pragma once

#include "ngn/native-module.h"

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

struct BundleFacts {
  std::optional<std::string> version;
  std::optional<std::string> build;
  std::optional<std::string> id;
  std::optional<std::string> displayName;
  std::optional<std::string> name;
};

struct MachineFacts {
  // "MacBook Pro (14-inch, Nov 2023)"; nothing where the Mac does not say.
  std::optional<std::string> marketingName;
  // "Mac15,3"
  std::string modelId;
  // "26.1"
  std::string osVersion;
  // "25B78"
  std::string osBuildId;
  // The name the user gave the Mac.
  std::optional<std::string> deviceName;
  uint64_t totalMemory{0};
  // "arm64", "x86_64"
  std::vector<std::string> architectures;
};

// `appId` and `appName` stand in for what a bundle with no Info.plist does not have.
std::shared_ptr<NativeModule> makeApplicationModule(BundleFacts bundle, std::string appId, std::string appName);
std::shared_ptr<NativeModule> makeDeviceModule(MachineFacts machine);

} // namespace ngn
