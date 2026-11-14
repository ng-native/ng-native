// The small modules: what the app and its window are like, and the iOS-only ones that have
// nothing to do on a desktop.
#include "ngn/core-modules.h"

#include <cstdlib>
#include <sstream>

namespace ngn {

namespace {

folly::dynamic dimensions(const Dimensions &d) {
  return folly::dynamic::object("width", d.width)("height", d.height)("scale", d.scale)("fontScale", d.fontScale);
}

folly::dynamic dimensionsPayload(const WindowMetrics &m) {
  return folly::dynamic::object("window", dimensions(m.window))("screen", dimensions(m.screen));
}

const char *activityName(Activity a) {
  switch (a) {
    case Activity::Active:
      return "active";
    case Activity::Inactive:
      return "inactive";
    case Activity::Background:
      return "background";
  }
  return "active";
}

folly::dynamic version(std::string v) {
  std::string prerelease;
  if (auto dash = v.find('-'); dash != std::string::npos) {
    prerelease = v.substr(dash + 1);
    v.resize(dash);
  }
  int parts[3] = {0, 0, 0};
  std::stringstream in(v);
  std::string piece;
  for (int i = 0; i < 3 && std::getline(in, piece, '.'); i++) {
    parts[i] = std::atoi(piece.c_str());
  }
  return folly::dynamic::object("major", parts[0])("minor", parts[1])("patch", parts[2])(
      "prerelease", prerelease.empty() ? folly::dynamic(nullptr) : folly::dynamic(prerelease));
}

// A module that keeps listening to the host state while it lives.
struct Listening : NativeModule {
  using NativeModule::NativeModule;
  std::vector<std::shared_ptr<void>> subscriptions;
};

} // namespace

std::shared_ptr<NativeModule> makePlatformConstants(const CoreModuleServices &s) {
  struct PlatformConstants : NativeModule {
    explicit PlatformConstants(const CoreModuleServices &s) : NativeModule("PlatformConstants") {
      auto system = s.system;
      auto rn = version(s.reactNativeVersion);
      constants([system, rn] {
        auto facts = system->facts();
        return folly::dynamic::object("isTesting", false)("isDisableAnimations", false)("reactNativeVersion", rn)(
            "forceTouchAvailable", false)("osVersion", facts.osVersion)("systemName", facts.systemName)(
            "interfaceIdiom", "mac")("isMacCatalyst", false);
      });
    }
  };
  return std::make_shared<PlatformConstants>(s);
}

std::shared_ptr<NativeModule> makeDeviceInfo(const CoreModuleServices &s) {
  struct DeviceInfo : Listening {
    explicit DeviceInfo(const CoreModuleServices &s) : Listening("DeviceInfo") {
      auto state = s.state;
      constants([state] {
        return folly::dynamic::object("Dimensions", dimensionsPayload(state->metrics.get()))("isIPhoneX_deprecated", false);
      });
      subscriptions.push_back(
          state->metrics.listen([this](const WindowMetrics &m) { emit("didUpdateDimensions", dimensionsPayload(m)); }));
    }
  };
  return std::make_shared<DeviceInfo>(s);
}

std::shared_ptr<NativeModule> makeAppState(const CoreModuleServices &s) {
  struct AppState : Listening {
    explicit AppState(const CoreModuleServices &s) : Listening("AppState") {
      auto state = s.state;
      constants([state] { return folly::dynamic::object("initialAppState", activityName(state->activity.get())); });
      async("getCurrentAppState", [state](const folly::dynamic &, std::vector<JsCallback> callbacks) {
        if (!callbacks.empty()) {
          callbacks[0](folly::dynamic::array(folly::dynamic::object("app_state", activityName(state->activity.get()))));
        }
      });
      listeners();
      subscriptions.push_back(state->activity.listen([this](const Activity &a) {
        emit("appStateDidChange", folly::dynamic::object("app_state", activityName(a)));
      }));
    }
  };
  return std::make_shared<AppState>(s);
}

std::shared_ptr<NativeModule> makeAppearance(const CoreModuleServices &s) {
  struct Appearance : Listening {
    explicit Appearance(const CoreModuleServices &s) : Listening("Appearance") {
      auto state = s.state;
      auto system = s.system;
      sync("getColorScheme", [state](const folly::dynamic &) { return state->colorScheme.get(); });
      async("setColorScheme", [system, state](const folly::dynamic &args, std::vector<JsCallback>) {
        std::string scheme = args.size() > 0 && args[0].isString() ? args[0].asString() : "unspecified";
        if (scheme == "light" || scheme == "dark") {
          system->setColorScheme(scheme);
        } else {
          system->setColorScheme(std::nullopt);
        }
        // The backend reports the scheme it now draws in through the host state.
        state->colorScheme.set(system->colorScheme());
      });
      listeners();
      subscriptions.push_back(state->colorScheme.listen([this](const std::string &scheme) {
        emit("appearanceChanged", folly::dynamic::object("colorScheme", scheme));
      }));
    }
  };
  return std::make_shared<Appearance>(s);
}

std::shared_ptr<NativeModule> makeLinking(const CoreModuleServices &s) {
  struct Linking : Listening {
    explicit Linking(const CoreModuleServices &s) : Listening("LinkingManager") {
      auto state = s.state;
      auto system = s.system;
      promise("getInitialURL", [state](const folly::dynamic &, JsPromise p) {
        auto url = state->initialUrl();
        p.resolve(url ? folly::dynamic(*url) : folly::dynamic(nullptr));
      });
      promise("canOpenURL", [system](const folly::dynamic &args, JsPromise p) {
        p.resolve(args.size() > 0 && args[0].isString() && system->canOpenUrl(args[0].asString()));
      });
      promise("openURL", [system](const folly::dynamic &args, JsPromise p) {
        if (args.size() == 0 || !args[0].isString()) {
          p.reject("Invalid URL");
          return;
        }
        std::string url = args[0].asString();
        system->openUrl(url, [p, url](bool opened) {
          if (opened) {
            p.resolve(true);
          } else {
            p.reject("Unable to open URL: " + url);
          }
        });
      });
      promise("openSettings", [system](const folly::dynamic &, JsPromise p) {
        system->openSettings([p](bool opened) {
          if (opened) {
            p.resolve(true);
          } else {
            p.reject("Unable to open the app's settings");
          }
        });
      });
      // URLs that arrive before JavaScript listens wait for it: the first addListener takes them.
      async("addListener", [this, state](const folly::dynamic &, std::vector<JsCallback>) {
        if (subscriptions.empty()) {
          subscriptions.push_back(
              state->listenForUrls([this](const std::string &url) { emit("url", folly::dynamic::object("url", url)); }));
        }
      });
      async("removeListeners", [](const folly::dynamic &, std::vector<JsCallback>) {});
    }
  };
  return std::make_shared<Linking>(s);
}

std::shared_ptr<NativeModule> makeI18n(const CoreModuleServices &s) {
  struct I18n : NativeModule {
    explicit I18n(const CoreModuleServices &s) : NativeModule("I18nManager") {
      auto system = s.system;
      // React Native iOS's keys and defaults: RTL is allowed and left and right swap, until the
      // app says otherwise; the choice persists across launches.
      auto flag = [system](const char *key, bool fallback) {
        auto value = system->preference(key);
        return value && value->isBool() ? value->asBool() : fallback;
      };
      constants([system, flag] {
        auto facts = system->facts();
        bool forced = flag("RCTI18nUtil_forceRTL", false);
        bool allowed = flag("RCTI18nUtil_allowRTL", true);
        std::string locale = facts.locale;
        for (auto &c : locale) {
          if (c == '-') {
            c = '_';
          }
        }
        return folly::dynamic::object("isRTL", forced || (allowed && facts.rightToLeft))(
            "doLeftAndRightSwapInRTL", flag("RCTI18nUtil_makeRTLFlipLeftAndRightStyles", true))(
            "localeIdentifier", locale);
      });
      auto setter = [system](const char *key) {
        return [system, key](const folly::dynamic &args, std::vector<JsCallback>) {
          if (args.size() > 0 && args[0].isBool()) {
            system->setPreference(key, args[0]);
          }
        };
      };
      async("allowRTL", setter("RCTI18nUtil_allowRTL"));
      async("forceRTL", setter("RCTI18nUtil_forceRTL"));
      async("swapLeftAndRightInRTL", setter("RCTI18nUtil_makeRTLFlipLeftAndRightStyles"));
    }
  };
  return std::make_shared<I18n>(s);
}

std::shared_ptr<NativeModule> makeClipboard(const CoreModuleServices &s) {
  struct Clipboard : NativeModule {
    explicit Clipboard(const CoreModuleServices &s) : NativeModule("Clipboard") {
      auto system = s.system;
      constants([] { return folly::dynamic::object(); });
      promise("getString", [system](const folly::dynamic &, JsPromise p) { p.resolve(system->clipboardText().value_or("")); });
      async("setString", [system](const folly::dynamic &args, std::vector<JsCallback>) {
        system->setClipboardText(args.size() > 0 && args[0].isString() ? args[0].asString() : "");
      });
    }
  };
  return std::make_shared<Clipboard>(s);
}

std::shared_ptr<NativeModule> makeSettingsManager(const CoreModuleServices &s) {
  // iOS's Settings: an app's own values in the user defaults, read once at startup.
  struct Settings : NativeModule {
    explicit Settings(const CoreModuleServices &s) : NativeModule("SettingsManager") {
      auto system = s.system;
      constexpr const char *key = "ngn.settings";
      auto stored = [system] {
        auto value = system->preference(key);
        return value && value->isObject() ? *value : folly::dynamic::object();
      };
      constants([stored] { return folly::dynamic::object("settings", stored()); });
      async("setValues", [system, stored](const folly::dynamic &args, std::vector<JsCallback>) {
        auto values = stored();
        if (args.size() > 0 && args[0].isObject()) {
          for (const auto &[k, v] : args[0].items()) {
            values[k] = v;
          }
        }
        system->setPreference(key, values);
      });
      async("deleteValues", [system, stored](const folly::dynamic &args, std::vector<JsCallback>) {
        auto values = stored();
        if (args.size() > 0 && args[0].isArray()) {
          for (const auto &k : args[0]) {
            values.erase(k);
          }
        }
        system->setPreference(key, values);
      });
    }
  };
  return std::make_shared<Settings>(s);
}

std::shared_ptr<NativeModule> makeStatusBarManager(const CoreModuleServices &) {
  // A desktop window has no status bar: zero height, and every setter does nothing.
  struct StatusBar : NativeModule {
    StatusBar() : NativeModule("StatusBarManager") {
      constants([] { return folly::dynamic::object("HEIGHT", 0); });
      async("getHeight", [](const folly::dynamic &, std::vector<JsCallback> callbacks) {
        if (!callbacks.empty()) {
          callbacks[0](folly::dynamic::array(folly::dynamic::object("height", 0)));
        }
      });
      for (const char *name : {"setStyle", "setHidden", "setNetworkActivityIndicatorVisible"}) {
        async(name, [](const folly::dynamic &, std::vector<JsCallback>) {});
      }
      listeners();
    }
  };
  return std::make_shared<StatusBar>();
}

std::shared_ptr<NativeModule> makeVibration(const CoreModuleServices &) {
  struct Vibration : NativeModule {
    Vibration() : NativeModule("Vibration") {
      constants([] { return folly::dynamic::object(); });
      for (const char *name : {"vibrate", "vibrateByPattern", "cancel"}) {
        async(name, [](const folly::dynamic &, std::vector<JsCallback>) {});
      }
    }
  };
  return std::make_shared<Vibration>();
}

std::shared_ptr<NativeModule> makeKeyboardObserver(const CoreModuleServices &) {
  // A desktop keyboard never covers the window, so the keyboard events never come.
  struct KeyboardObserver : NativeModule {
    KeyboardObserver() : NativeModule("KeyboardObserver") {
      listeners();
    }
  };
  return std::make_shared<KeyboardObserver>();
}

std::shared_ptr<NativeModule> makeScreensModule(const CoreModuleServices &) {
  // react-native-screens' module, whose spec has no methods: it only has to exist.
  return std::make_shared<NativeModule>("RNSModule");
}

} // namespace ngn
