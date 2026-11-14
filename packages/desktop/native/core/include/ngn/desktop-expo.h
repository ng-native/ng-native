// The desktop host's Expo modules (@ng-native/expo's DESKTOP_MODULES): each is `NgNative` and the
// package's name after `expo-`, answering the methods @ng-native/expo calls on the Expo package,
// so a service works unchanged. The OS is reached through narrow interfaces, which the AppKit
// backend implements (the Keychain, the pasteboard, IOKit's power assertions, the trackpad).
//
// - NgNativeSecureStore: getItemAsync, setItemAsync, deleteItemAsync, getItem, setItem and
//   canUseBiometricAuthentication, over a SecretStore. Keys follow expo-secure-store's rule
//   (letters, digits, `.`, `-` and `_`), and the `keychainService` option picks the service.
// - NgNativeClipboard: getStringAsync, setStringAsync and hasStringAsync, over System's pasteboard.
// - NgNativeKeepAwake: activateKeepAwakeAsync and deactivateKeepAwake by tag; the display stays
//   awake while any tag holds it.
// - NgNativeHaptics: impactAsync, notificationAsync and selectionAsync, as the trackpad's feedback.
#pragma once

#include "ngn/native-module.h"
#include "ngn/system.h"

#include <memory>
#include <optional>
#include <set>
#include <string>

namespace ngn {

class SecretStore {
 public:
  virtual ~SecretStore() = default;
  // Nothing when there is no such item. Throws std::runtime_error when the store fails.
  virtual std::optional<std::string> get(const std::string &service, const std::string &key) = 0;
  virtual void set(const std::string &service, const std::string &key, const std::string &value) = 0;
  virtual void remove(const std::string &service, const std::string &key) = 0;
};

// The service items go under when the call names none: the app's own.
std::shared_ptr<NativeModule> makeSecureStoreModule(std::shared_ptr<SecretStore> store, std::string defaultService);
bool secureStoreKeyValid(const std::string &key);

std::shared_ptr<NativeModule> makeDesktopClipboardModule(std::shared_ptr<System> system);

class SleepPreventer {
 public:
  virtual ~SleepPreventer() = default;
  // Keep the display awake, or let it sleep again.
  virtual void hold(bool awake) = 0;
};

// The tags holding the display awake: it is held while there is any.
class KeepAwakeTags {
 public:
  explicit KeepAwakeTags(std::shared_ptr<SleepPreventer> preventer) : preventer_(std::move(preventer)) {}
  void activate(const std::string &tag);
  void deactivate(const std::string &tag);

 private:
  std::shared_ptr<SleepPreventer> preventer_;
  std::set<std::string> tags_;
};

std::shared_ptr<NativeModule> makeKeepAwakeModule(std::shared_ptr<KeepAwakeTags> tags);

class HapticPlayer {
 public:
  enum class Pattern { Generic, Alignment, LevelChange };
  virtual ~HapticPlayer() = default;
  virtual void play(Pattern pattern) = 0;
};

// The pattern each of expo-haptics' calls plays: an impact is generic, a selection an alignment,
// a notification a level change.
std::optional<HapticPlayer::Pattern> hapticPattern(const std::string &method);

std::shared_ptr<NativeModule> makeHapticsModule(std::shared_ptr<HapticPlayer> player);

} // namespace ngn
