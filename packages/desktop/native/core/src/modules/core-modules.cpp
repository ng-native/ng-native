#include "ngn/core-modules.h"

namespace ngn {

void addCoreModules(ModuleRegistry &registry, const CoreModuleServices &given) {
  CoreModuleServices services = given;
  if (!services.blobs) {
    services.blobs = std::make_shared<BlobStore>();
  }
  if (!services.storage) {
    services.storage = std::make_shared<KeyValueStore>(services.system->appDataDirectory() + "/async-storage");
  }
  using Make = std::shared_ptr<NativeModule> (*)(const CoreModuleServices &);
  const std::pair<const char *, Make> modules[] = {
      {"PlatformConstants", makePlatformConstants},
      {"DeviceInfo", makeDeviceInfo},
      {"AppState", makeAppState},
      {"Appearance", makeAppearance},
      {"LinkingManager", makeLinking},
      {"I18nManager", makeI18n},
      {"AlertManager", makeAlertManager},
      {"Clipboard", makeClipboard},
      {"SettingsManager", makeSettingsManager},
      {"StatusBarManager", makeStatusBarManager},
      {"Vibration", makeVibration},
      {"KeyboardObserver", makeKeyboardObserver},
      {"RNSModule", makeScreensModule},
      {"Networking", makeNetworking},
      {"WebSocketModule", makeWebSocket},
      {"BlobModule", makeBlobModule},
      {"FileReaderModule", makeFileReader},
      {"RNCAsyncStorage", makeLegacyAsyncStorage},
      {"RNAsyncStorage", makeAsyncStorage},
  };
  for (const auto &[name, make] : modules) {
    addModule(registry, name, [services, make] { return make(services); });
  }
}

} // namespace ngn
