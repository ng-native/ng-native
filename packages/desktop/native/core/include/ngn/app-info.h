// NgNativeApplication and NgNativeDevice: the constants @ng-native/expo's AppInfo reads off
// expo-application and expo-device, as properties.
//
// - NgNativeApplication: nativeApplicationVersion (CFBundleShortVersionString),
//   nativeBuildVersion (CFBundleVersion), applicationId (CFBundleIdentifier) and applicationName
//   (CFBundleDisplayName, else CFBundleName). A dev run's binary has no bundle: its id and name are
//   the app's own (app.json's), and its versions null.
// - NgNativeDevice: brand and manufacturer (the OS's maker where it makes the machines, "Apple" on
//   macOS, else the machine's own), modelName (the Mac's marketing name, else its model
//   identifier), modelId ("Mac15,3"), osName ("macOS"), osVersion, osBuildId, deviceName,
//   totalMemory, supportedCpuArchitectures, isDevice true (a desktop is never a simulator) and
//   deviceType 3, expo-device's DESKTOP.
#pragma once

#include "ngn/host-os.h"
#include "ngn/native-module.h"

#include <cstdint>
#include <functional>
#include <map>
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
  // The machine's maker, as its firmware names it ("LENOVO"): Device's brand where the OS has no
  // maker of its own (HostOs::deviceMaker). Nothing where the firmware does not say.
  std::optional<std::string> manufacturer;
  // "MacBook Pro (14-inch, Nov 2023)"; nothing where the Mac does not say.
  std::optional<std::string> marketingName;
  // "Mac15,3"; on Linux, the firmware's product name.
  std::string modelId;
  // "26.1"; on Linux, the distribution's version ("9.4").
  std::string osVersion;
  // "25B78"; on Linux, the kernel's release.
  std::string osBuildId;
  // The name the user gave the Mac.
  std::optional<std::string> deviceName;
  uint64_t totalMemory{0};
  // "arm64", "x86_64"
  std::vector<std::string> architectures;
};

// The bundle facts in a package's Info.plist keys (CFBundleShortVersionString, CFBundleVersion,
// CFBundleIdentifier, CFBundleDisplayName and CFBundleName), as `plist` answers them: a Linux
// package's metadata.json (packagedMetadata), which has no bundle of its own to read.
BundleFacts bundleFactsOf(const std::function<std::optional<std::string>(const std::string &)> &plist);

// The fields of an os-release file (`NAME="AlmaLinux"`), unquoted and unescaped; comments and
// lines that are not assignments are skipped.
std::map<std::string, std::string> osReleaseFields(const std::string &text);

// `appId` and `appName` stand in for what a bundle with no Info.plist does not have.
std::shared_ptr<NativeModule> makeApplicationModule(BundleFacts bundle, std::string appId, std::string appName);
// `os` gives osName and, where the OS's maker makes the machine, the brand.
std::shared_ptr<NativeModule> makeDeviceModule(MachineFacts machine, const HostOs &os);

} // namespace ngn
