#include "ngn/core-modules.h"

#include "ngn/file-system.h"

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
      {"AccessibilityManager", makeAccessibilityManager},
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
      {"ImageLoader", makeImageLoader},
      {"WebSocketModule", makeWebSocket},
      {"BlobModule", makeBlobModule},
      {"FileReaderModule", makeFileReader},
      {"RNCAsyncStorage", makeLegacyAsyncStorage},
      {"RNAsyncStorage", makeAsyncStorage},
  };
  for (const auto &[name, make] : modules) {
    addModule(registry, name, [services, make] { return make(services); });
  }
  if (services.bundle) {
    addModule(registry, "SourceCode", [services] { return makeSourceCode(services); });
  }
}

std::shared_ptr<NativeModule> makeSourceCode(const CoreModuleServices &services) {
  struct SourceCode : NativeModule {
    explicit SourceCode(std::function<std::string()> bundle) : NativeModule("SourceCode") {
      // Asked as each runtime starts, so a reload into an update's bundle reads that one.
      constants([bundle = std::move(bundle)] {
        auto at = bundle ? bundle() : std::string();
        bool url = at.starts_with("http://") || at.starts_with("https://") || at.starts_with("file://");
        return folly::dynamic::object("scriptURL", url || at.empty() ? at : fileUri(at));
      });
    }
  };
  return std::make_shared<SourceCode>(services.bundle);
}

} // namespace ngn
