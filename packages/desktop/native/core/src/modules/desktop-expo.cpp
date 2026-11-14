#include "ngn/desktop-expo.h"

#include <algorithm>
#include <cctype>
#include <stdexcept>

namespace ngn {

namespace {

std::string stringArg(const folly::dynamic &args, size_t index) {
  return args.size() > index && args[index].isString() ? args[index].asString() : std::string{};
}

// expo-secure-store's options object: `keychainService` picks the service.
std::string serviceFrom(const folly::dynamic &args, size_t index, const std::string &fallback) {
  if (args.size() > index && args[index].isObject()) {
    auto it = args[index].find("keychainService");
    if (it != args[index].items().end() && it->second.isString() && !it->second.asString().empty()) {
      return it->second.asString();
    }
  }
  return fallback;
}

} // namespace

bool secureStoreKeyValid(const std::string &key) {
  return !key.empty() && std::all_of(key.begin(), key.end(), [](unsigned char c) {
    return std::isalnum(c) || c == '.' || c == '-' || c == '_';
  });
}

std::shared_ptr<NativeModule> makeSecureStoreModule(std::shared_ptr<SecretStore> store, std::string defaultService) {
  struct SecureStore : NativeModule {
    SecureStore(std::shared_ptr<SecretStore> store, std::string service) : NativeModule("NgNativeSecureStore") {
      auto invalid = [](const std::string &key) {
        return "Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric "
               "characters, \".\", \"-\", and \"_\": " + key;
      };
      promise("getItemAsync", [store, service, invalid](const folly::dynamic &args, JsPromise promise) {
        auto key = stringArg(args, 0);
        if (!secureStoreKeyValid(key)) {
          promise.reject(invalid(key));
          return;
        }
        try {
          auto value = store->get(serviceFrom(args, 1, service), key);
          promise.resolve(value ? folly::dynamic(*value) : folly::dynamic(nullptr));
        } catch (const std::exception &error) {
          promise.reject(error.what());
        }
      });
      promise("setItemAsync", [store, service, invalid](const folly::dynamic &args, JsPromise promise) {
        auto key = stringArg(args, 0);
        if (!secureStoreKeyValid(key)) {
          promise.reject(invalid(key));
          return;
        }
        if (args.size() < 2 || !args[1].isString()) {
          promise.reject("Invalid value provided to SecureStore. Values must be strings.");
          return;
        }
        try {
          store->set(serviceFrom(args, 2, service), key, args[1].asString());
          promise.resolve(nullptr);
        } catch (const std::exception &error) {
          promise.reject(error.what());
        }
      });
      promise("deleteItemAsync", [store, service, invalid](const folly::dynamic &args, JsPromise promise) {
        auto key = stringArg(args, 0);
        if (!secureStoreKeyValid(key)) {
          promise.reject(invalid(key));
          return;
        }
        try {
          store->remove(serviceFrom(args, 1, service), key);
          promise.resolve(nullptr);
        } catch (const std::exception &error) {
          promise.reject(error.what());
        }
      });
      sync("getItem", [store, service](const folly::dynamic &args) -> folly::dynamic {
        auto key = stringArg(args, 0);
        if (!secureStoreKeyValid(key)) {
          return nullptr;
        }
        try {
          auto value = store->get(serviceFrom(args, 1, service), key);
          return value ? folly::dynamic(*value) : folly::dynamic(nullptr);
        } catch (const std::exception &) {
          return nullptr;
        }
      });
      sync("setItem", [store, service](const folly::dynamic &args) -> folly::dynamic {
        auto key = stringArg(args, 0);
        if (secureStoreKeyValid(key) && args.size() > 1 && args[1].isString()) {
          try {
            store->set(serviceFrom(args, 2, service), key, args[1].asString());
          } catch (const std::exception &) {
          }
        }
        return nullptr;
      });
      // Touch ID guarding an item is not offered on the desktop yet.
      sync("canUseBiometricAuthentication", [](const folly::dynamic &) { return folly::dynamic(false); });
    }
  };
  return std::make_shared<SecureStore>(std::move(store), std::move(defaultService));
}

std::shared_ptr<NativeModule> makeDesktopClipboardModule(std::shared_ptr<System> system) {
  struct Clipboard : NativeModule {
    explicit Clipboard(std::shared_ptr<System> system) : NativeModule("NgNativeClipboard") {
      promise("getStringAsync", [system](const folly::dynamic &, JsPromise promise) {
        promise.resolve(system->clipboardText().value_or(""));
      });
      promise("setStringAsync", [system](const folly::dynamic &args, JsPromise promise) {
        system->setClipboardText(stringArg(args, 0));
        promise.resolve(true);
      });
      promise("hasStringAsync", [system](const folly::dynamic &, JsPromise promise) {
        auto text = system->clipboardText();
        promise.resolve(text.has_value() && !text->empty());
      });
    }
  };
  return std::make_shared<Clipboard>(std::move(system));
}

void KeepAwakeTags::activate(const std::string &tag) {
  bool was = !tags_.empty();
  tags_.insert(tag);
  if (!was) {
    preventer_->hold(true);
  }
}

void KeepAwakeTags::deactivate(const std::string &tag) {
  if (tags_.erase(tag) > 0 && tags_.empty()) {
    preventer_->hold(false);
  }
}

std::shared_ptr<NativeModule> makeKeepAwakeModule(std::shared_ptr<KeepAwakeTags> tags) {
  struct KeepAwake : NativeModule {
    explicit KeepAwake(std::shared_ptr<KeepAwakeTags> tags) : NativeModule("NgNativeKeepAwake") {
      promise("activateKeepAwakeAsync", [tags](const folly::dynamic &args, JsPromise promise) {
        tags->activate(stringArg(args, 0));
        promise.resolve(nullptr);
      });
      promise("deactivateKeepAwake", [tags](const folly::dynamic &args, JsPromise promise) {
        tags->deactivate(stringArg(args, 0));
        promise.resolve(nullptr);
      });
      sync("isAvailableAsync", [](const folly::dynamic &) { return folly::dynamic(true); });
    }
  };
  return std::make_shared<KeepAwake>(std::move(tags));
}

std::optional<HapticPlayer::Pattern> hapticPattern(const std::string &method) {
  if (method == "impactAsync") {
    return HapticPlayer::Pattern::Generic;
  }
  if (method == "selectionAsync") {
    return HapticPlayer::Pattern::Alignment;
  }
  if (method == "notificationAsync") {
    return HapticPlayer::Pattern::LevelChange;
  }
  return std::nullopt;
}

std::shared_ptr<NativeModule> makeHapticsModule(std::shared_ptr<HapticPlayer> player) {
  struct Haptics : NativeModule {
    explicit Haptics(std::shared_ptr<HapticPlayer> player) : NativeModule("NgNativeHaptics") {
      for (const char *method : {"impactAsync", "selectionAsync", "notificationAsync"}) {
        auto pattern = *hapticPattern(method);
        promise(method, [player, pattern](const folly::dynamic &, JsPromise promise) {
          player->play(pattern);
          promise.resolve(nullptr);
        });
      }
    }
  };
  return std::make_shared<Haptics>(std::move(player));
}

namespace {

struct TagParts {
  std::string language;
  std::string script;
  std::string region;
};

// The language, script and region subtags of a BCP 47 tag ("zh-Hant-TW"), as far as it has them.
TagParts tagParts(const std::string &tag) {
  TagParts parts;
  size_t at = 0;
  int index = 0;
  while (at <= tag.size()) {
    size_t end = tag.find_first_of("-_", at);
    auto subtag = tag.substr(at, end == std::string::npos ? std::string::npos : end - at);
    bool letters = std::all_of(subtag.begin(), subtag.end(), [](unsigned char c) { return std::isalpha(c); });
    bool digits = std::all_of(subtag.begin(), subtag.end(), [](unsigned char c) { return std::isdigit(c); });
    if (index == 0) {
      parts.language = subtag;
    } else if (parts.script.empty() && parts.region.empty() && subtag.size() == 4 && letters) {
      parts.script = subtag;
    } else if (parts.region.empty() && ((subtag.size() == 2 && letters) || (subtag.size() == 3 && digits))) {
      parts.region = subtag;
    }
    if (end == std::string::npos) {
      break;
    }
    at = end + 1;
    index++;
  }
  return parts;
}

folly::dynamic orNull(const std::string &value) {
  return value.empty() ? folly::dynamic(nullptr) : folly::dynamic(value);
}

const char *measurement(const std::string &system) {
  if (system == "U.S.") {
    return "us";
  }
  if (system == "U.K.") {
    return "uk";
  }
  return "metric";
}

} // namespace

std::shared_ptr<NativeModule> makeLocalizationModule(std::shared_ptr<LocaleSource> source, std::string regionCode) {
  struct Localization : NativeModule {
    Localization(std::shared_ptr<LocaleSource> source, std::string region) : NativeModule("NgNativeLocalization") {
      sync("getLocales", [source, region](const folly::dynamic &) {
        auto locales = source->locales();
        if (locales.empty()) {
          locales.push_back({.languageTag = "en-" + region});
        }
        folly::dynamic out = folly::dynamic::array();
        for (const auto &locale : locales) {
          auto parts = tagParts(locale.languageTag);
          out.push_back(folly::dynamic::object("languageTag", locale.languageTag)("languageCode", orNull(parts.language))(
              "languageScriptCode", orNull(parts.script))("regionCode", orNull(parts.region.empty() ? region : parts.region))(
              "languageRegionCode", orNull(parts.region))("textDirection", locale.rightToLeft ? "rtl" : "ltr")(
              "decimalSeparator", orNull(locale.decimalSeparator))("digitGroupingSeparator", orNull(locale.groupingSeparator))(
              "measurementSystem", measurement(locale.measurementSystem))("currencyCode", orNull(locale.currencyCode))(
              "currencySymbol", orNull(locale.currencySymbol))("languageCurrencyCode", orNull(locale.currencyCode))(
              "languageCurrencySymbol", orNull(locale.currencySymbol))("temperatureUnit", orNull(locale.temperatureUnit)));
        }
        return out;
      });
      sync("getCalendars", [source](const folly::dynamic &) {
        auto c = source->calendars();
        return folly::dynamic::array(folly::dynamic::object("calendar", orNull(c.calendar))("timeZone", orNull(c.timeZone))(
            "uses24hourClock", c.uses24hourClock)("firstWeekday", c.firstWeekday));
      });
    }
  };
  return std::make_shared<Localization>(std::move(source), std::move(regionCode));
}

} // namespace ngn
