// React Native's iOS-shaped modules, implemented once in the core for every desktop backend.
// macOS runs React Native's iOS JavaScript, so each module answers under its iOS name with the
// iOS shapes. Each is a NativeModule: plain C++ over the System and HostState interfaces.
#pragma once

#include "ngn/host-state.h"
#include "ngn/module-registry.h"
#include "ngn/native-module.h"
#include "ngn/network.h"
#include "ngn/system.h"

#include <memory>
#include <string>

namespace ngn {

struct CoreModuleServices {
  std::shared_ptr<System> system;
  std::shared_ptr<HostState> state;
  std::shared_ptr<Http> http;
  std::shared_ptr<WebSockets> webSockets;
  // "0.88.0", the React Native the host was built from, which its JavaScript checks.
  std::string reactNativeVersion;
};

// Registers every core module.
void addCoreModules(ModuleRegistry &registry, const CoreModuleServices &services);

// The modules one at a time, for tests.
std::shared_ptr<NativeModule> makePlatformConstants(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeDeviceInfo(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeAppState(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeAppearance(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeLinking(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeI18n(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeAlertManager(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeClipboard(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeSettingsManager(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeStatusBarManager(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeVibration(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeKeyboardObserver(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeScreensModule(const CoreModuleServices &services);

// The alert JavaScript asked for (AlertManager.alertWithArgs) as the backend shows it, and the
// button keys in the request's order, so a pressed index maps back to the key JavaScript gave.
struct PreparedAlert {
  AlertRequest request;
  std::vector<std::string> keys;
};
PreparedAlert prepareAlert(const folly::dynamic &args);

} // namespace ngn
