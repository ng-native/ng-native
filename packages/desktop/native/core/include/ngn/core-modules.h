// React Native's iOS-shaped modules, implemented once in the core for every desktop backend.
// macOS runs React Native's iOS JavaScript, so each module answers under its iOS name with the
// iOS shapes. Each is a NativeModule: plain C++ over the System and HostState interfaces.
#pragma once

#include "ngn/bytes.h"
#include "ngn/host-state.h"
#include "ngn/key-value-store.h"
#include "ngn/module-registry.h"
#include "ngn/native-module.h"
#include "ngn/network.h"
#include "ngn/system.h"

#include <functional>
#include <memory>
#include <string>

namespace ngn {

struct CoreModuleServices {
  std::shared_ptr<System> system;
  std::shared_ptr<HostState> state;
  std::shared_ptr<Http> http;
  std::shared_ptr<WebSockets> webSockets;
  // Made by addCoreModules when not given: one for every runtime, shared by its modules.
  std::shared_ptr<BlobStore> blobs;
  // AsyncStorage's files. Made by addCoreModules when not given, in the app's data directory.
  std::shared_ptr<KeyValueStore> storage;
  // "0.88.0", the React Native the host was built from, which its JavaScript checks.
  std::string reactNativeVersion;
  // The bundle the runtime runs now: a path, or a dev server's URL. SourceCode is registered only
  // with it.
  std::function<std::string()> bundle;
  // Moves the screen reader to the view with this tag (AccessibilityInfo.setAccessibilityFocus).
  // Any thread; nothing when absent.
  std::function<void(int tag)> focusAccessibility;
};

// Registers every core module.
void addCoreModules(ModuleRegistry &registry, const CoreModuleServices &services);

// The modules one at a time, for tests.
std::shared_ptr<NativeModule> makePlatformConstants(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeDeviceInfo(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeAppState(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeAppearance(const CoreModuleServices &services);
// AccessibilityInfo's iOS module: the settings in the host state and their change events.
std::shared_ptr<NativeModule> makeAccessibilityManager(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeLinking(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeI18n(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeAlertManager(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeClipboard(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeSettingsManager(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeStatusBarManager(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeVibration(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeKeyboardObserver(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeScreensModule(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeNetworking(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeImageLoader(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeWebSocket(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeBlobModule(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeFileReader(const CoreModuleServices &services);
// @react-native-async-storage: RNCAsyncStorage for 2.x, RNAsyncStorage for 3.x, over one store.
std::shared_ptr<NativeModule> makeLegacyAsyncStorage(const CoreModuleServices &services);
std::shared_ptr<NativeModule> makeAsyncStorage(const CoreModuleServices &services);
// SourceCode's scriptURL, which React Native's asset resolver finds a bundle's assets beside, as
// iOS's RCTSourceCode gives it. React Native's own answers nothing for a bundle on disk.
std::shared_ptr<NativeModule> makeSourceCode(const CoreModuleServices &services);

// The body of a request JavaScript sent (Networking.sendRequest's `data`), and the content type
// it implies when the request has none.
struct RequestBody {
  std::string bytes;
  std::string contentType;
  std::string error;
};
RequestBody requestBody(const folly::dynamic &data, const BlobStore &blobs, const std::string &boundary);

// The alert JavaScript asked for (AlertManager.alertWithArgs) as the backend shows it, and the
// button keys in the request's order, so a pressed index maps back to the key JavaScript gave.
struct PreparedAlert {
  AlertRequest request;
  std::vector<std::string> keys;
};
PreparedAlert prepareAlert(const folly::dynamic &args);

} // namespace ngn
