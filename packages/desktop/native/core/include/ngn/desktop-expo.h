// The desktop host's Expo modules (@ng-native/expo's DESKTOP_MODULES): each is `NgNative` and the
// package's name after `expo-`, answering the methods @ng-native/expo calls on the Expo package,
// so a service works unchanged. The OS is reached through narrow interfaces, which the AppKit
// backend implements (the Keychain, the pasteboard, IOKit's power assertions, the trackpad).
//
// - NgNativeSecureStore: getItemAsync, setItemAsync, deleteItemAsync, getItem, setItem and
//   canUseBiometricAuthentication, over a SecretStore. Keys follow expo-secure-store's rule
//   (letters, digits, `.`, `-` and `_`), and the `keychainService` option picks the service.
// - NgNativeClipboard: getStringAsync, setStringAsync and hasStringAsync, over System's pasteboard,
//   and `ngNativeClipboard` on DeviceEventEmitter each time HostState's clipboard change count moves.
// - NgNativeKeepAwake: activateKeepAwakeAsync and deactivateKeepAwake by tag; the display stays
//   awake while any tag holds it.
// - NgNativeHaptics: impactAsync, notificationAsync and selectionAsync, as the trackpad's feedback.
// - NgNativeDocumentPicker: getDocumentAsync in expo-document-picker's shape (copied into the
//   cache unless copyToCacheDirectory is false), saveDocumentAsync (text, or bytes as {base64},
//   written where the save panel says; null when dismissed) and pickDirectoryAsync ({uri} or null),
//   over FileDialogs, with uris percent-encoded.
// - NgNativeLocalization: getLocales and getCalendars, in expo-localization's shapes, over a
//   LocaleSource (the user's preferred languages and the region's formats).
#pragma once

#include "ngn/file-system.h"
#include "ngn/host-state.h"
#include "ngn/native-module.h"
#include "ngn/system.h"

#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace ngn {

class SecretStore {
 public:
  virtual ~SecretStore() = default;
  // Nothing when there is no such item. Throws std::runtime_error when the store fails.
  virtual std::optional<std::string> get(const std::string &service, const std::string &key) = 0;
  virtual void set(const std::string &service, const std::string &key, const std::string &value) = 0;
  virtual void remove(const std::string &service, const std::string &key) = 0;
};

// Items in `now`, with what `old` still has moved over as it is read: the Data Protection keychain
// over the file keychain an app used before it was signed with a Team ID. A write or a removal
// takes the old copy away too, so it never comes back.
class MovingSecretStore final : public SecretStore {
 public:
  MovingSecretStore(std::shared_ptr<SecretStore> now, std::shared_ptr<SecretStore> old)
      : now_(std::move(now)), old_(std::move(old)) {}
  std::optional<std::string> get(const std::string &service, const std::string &key) override;
  void set(const std::string &service, const std::string &key, const std::string &value) override;
  void remove(const std::string &service, const std::string &key) override;

 private:
  void removeOld(const std::string &service, const std::string &key);
  std::shared_ptr<SecretStore> now_;
  std::shared_ptr<SecretStore> old_;
};

// A test launch's store: each service is `prefix` and the service asked for, so a run's items
// never meet the app's own or another run's. `clear()` removes every item this store wrote.
class PrefixedSecretStore final : public SecretStore {
 public:
  PrefixedSecretStore(std::shared_ptr<SecretStore> inner, std::string prefix) : inner_(std::move(inner)), prefix_(std::move(prefix)) {}
  std::optional<std::string> get(const std::string &service, const std::string &key) override;
  void set(const std::string &service, const std::string &key, const std::string &value) override;
  void remove(const std::string &service, const std::string &key) override;
  void clear();

 private:
  std::shared_ptr<SecretStore> inner_;
  std::string prefix_;
  std::mutex mutex_;
  std::set<std::pair<std::string, std::string>> written_;
};

// Whether the app can use the Data Protection keychain: its signature has a Team ID, and an
// entitlement that gives it a keychain access group (an application identifier, as a Mac App Store
// build has, or keychain-access-groups). Without one the keychain refuses it (errSecMissingEntitlement).
bool usesDataProtectionKeychain(const std::string &teamId, const std::set<std::string> &entitlements);

// The service items go under when the call names none: the app's own.
std::shared_ptr<NativeModule> makeSecureStoreModule(std::shared_ptr<SecretStore> store, std::string defaultService);
bool secureStoreKeyValid(const std::string &key);

std::shared_ptr<NativeModule> makeDesktopClipboardModule(std::shared_ptr<System> system, std::shared_ptr<HostState> state);

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

// The OS's open and save panels. Each answers on any thread, with nothing when dismissed.
class FileDialogs {
 public:
  struct OpenRequest {
    // MIME types ("text/plain", "image/*"); empty for any file.
    std::vector<std::string> types;
    bool multiple{false};
  };
  struct SaveRequest {
    std::string suggestedName;
    // MIME types the file may be saved as, the first the default.
    std::vector<std::string> types;
  };
  virtual ~FileDialogs() = default;
  virtual void openFiles(const OpenRequest &request, std::function<void(std::optional<std::vector<std::string>>)> done) = 0;
  virtual void saveFile(const SaveRequest &request, std::function<void(std::optional<std::string>)> done) = 0;
  virtual void chooseFolder(std::function<void(std::optional<std::string>)> done) = 0;
};

// Panels that answer as dismissed at once, never shown: a test launch's fake system UI.
std::shared_ptr<FileDialogs> makeDismissedFileDialogs();

// The MIME type of a file name's extension, or application/octet-stream.
std::string mimeTypeOf(const std::string &name);

// `cacheDirectory` is where picked files are copied. What the user picks or saves becomes
// reachable through `access`, NgNativeFileSystem's, when there is one.
std::shared_ptr<NativeModule> makeDocumentPickerModule(
    std::shared_ptr<FileDialogs> dialogs,
    std::string cacheDirectory,
    std::shared_ptr<FileAccess> access = nullptr);

// One of the user's preferred languages, with the formats of the region the system is set to.
struct LocaleFacts {
  // BCP 47: "en-GB", "zh-Hant-TW", "ar".
  std::string languageTag;
  bool rightToLeft{false};
  std::string decimalSeparator;
  std::string groupingSeparator;
  // As NSLocale says it: "Metric", "U.S." or "U.K.".
  std::string measurementSystem;
  std::string currencyCode;
  std::string currencySymbol;
  // "celsius" or "fahrenheit".
  std::string temperatureUnit;
};

struct CalendarFacts {
  // expo-localization's names: "gregorian", "buddhist", "japanese" and the rest.
  std::string calendar;
  std::string timeZone;
  bool uses24hourClock{false};
  // 1 is Sunday.
  int firstWeekday{1};
};

class LocaleSource {
 public:
  virtual ~LocaleSource() = default;
  // Most preferred first.
  virtual std::vector<LocaleFacts> locales() = 0;
  virtual CalendarFacts calendars() = 0;
};

// `regionCode` is the system's region ("GB"), which a language tag with no region of its own takes.
std::shared_ptr<NativeModule> makeLocalizationModule(std::shared_ptr<LocaleSource> source, std::string regionCode);

} // namespace ngn
