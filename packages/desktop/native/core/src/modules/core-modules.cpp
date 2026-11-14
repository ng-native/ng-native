#include "ngn/core-modules.h"

namespace ngn {

void addCoreModules(ModuleRegistry &registry, const CoreModuleServices &services) {
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
  };
  for (const auto &[name, make] : modules) {
    addModule(registry, name, [services, make] { return make(services); });
  }
}

} // namespace ngn
