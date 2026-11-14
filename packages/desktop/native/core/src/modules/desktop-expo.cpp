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

} // namespace ngn
