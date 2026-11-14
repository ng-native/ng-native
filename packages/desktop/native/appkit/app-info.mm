#include "app-info.h"

#import <Foundation/Foundation.h>
#import <IOKit/IOKitLib.h>
#import <SystemConfiguration/SystemConfiguration.h>

#include <sys/sysctl.h>

namespace ngn::appkit {

namespace {

std::optional<std::string> stringOf(id value) {
  if (![value isKindOfClass:NSString.class] || [value length] == 0) {
    return std::nullopt;
  }
  return std::string([value UTF8String]);
}

std::string sysctlString(const char *name) {
  size_t size = 0;
  if (sysctlbyname(name, nullptr, &size, nullptr, 0) != 0 || size == 0) {
    return "";
  }
  std::string value(size, '\0');
  if (sysctlbyname(name, value.data(), &size, nullptr, 0) != 0) {
    return "";
  }
  value.resize(strnlen(value.c_str(), size));
  return value;
}

bool sysctlFlag(const char *name) {
  int value = 0;
  size_t size = sizeof(value);
  return sysctlbyname(name, &value, &size, nullptr, 0) == 0 && value != 0;
}

// Apple silicon Macs name themselves in the device tree ("MacBook Pro (14-inch, Nov 2023)");
// Intel Macs do not, and the model identifier stands in.
std::optional<std::string> marketingName() {
  io_registry_entry_t product = IORegistryEntryFromPath(kIOMainPortDefault, "IODeviceTree:/product");
  if (product == MACH_PORT_NULL) {
    return std::nullopt;
  }
  std::optional<std::string> name;
  CFTypeRef value = IORegistryEntryCreateCFProperty(product, CFSTR("product-name"), kCFAllocatorDefault, 0);
  if (value != nullptr && CFGetTypeID(value) == CFDataGetTypeID()) {
    auto data = static_cast<CFDataRef>(value);
    auto bytes = reinterpret_cast<const char *>(CFDataGetBytePtr(data));
    std::string text(bytes, strnlen(bytes, CFDataGetLength(data)));
    if (!text.empty()) {
      name = text;
    }
  }
  if (value != nullptr) {
    CFRelease(value);
  }
  IOObjectRelease(product);
  return name;
}

} // namespace

BundleFacts mainBundleFacts() {
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
  return {
      .version = stringOf(info[@"CFBundleShortVersionString"]),
      .build = stringOf(info[@"CFBundleVersion"]),
      .id = stringOf(NSBundle.mainBundle.bundleIdentifier),
      .displayName = stringOf(info[@"CFBundleDisplayName"]),
      .name = stringOf(info[@"CFBundleName"]),
  };
}

MachineFacts machineFacts() {
  NSOperatingSystemVersion os = NSProcessInfo.processInfo.operatingSystemVersion;
  std::string version = std::to_string(os.majorVersion) + "." + std::to_string(os.minorVersion);
  if (os.patchVersion != 0) {
    version += "." + std::to_string(os.patchVersion);
  }
  MachineFacts facts{
      .marketingName = marketingName(),
      .modelId = sysctlString("hw.model"),
      .osVersion = version,
      .osBuildId = sysctlString("kern.osversion"),
      .totalMemory = NSProcessInfo.processInfo.physicalMemory,
      .architectures = {sysctlFlag("hw.optional.arm64") ? "arm64" : "x86_64"},
  };
  CFStringRef computer = SCDynamicStoreCopyComputerName(nullptr, nullptr);
  if (computer != nullptr) {
    facts.deviceName = stringOf((__bridge NSString *)computer);
    CFRelease(computer);
  }
  return facts;
}

} // namespace ngn::appkit
