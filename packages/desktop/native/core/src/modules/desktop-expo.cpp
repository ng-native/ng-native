#include "ngn/desktop-expo.h"

#include "ngn/bytes.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <map>
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

std::optional<std::string> PrefixedSecretStore::get(const std::string &service, const std::string &key) {
  return inner_->get(prefix_ + service, key);
}

void PrefixedSecretStore::set(const std::string &service, const std::string &key, const std::string &value) {
  inner_->set(prefix_ + service, key, value);
  std::lock_guard lock(mutex_);
  written_.insert({prefix_ + service, key});
}

void PrefixedSecretStore::remove(const std::string &service, const std::string &key) {
  inner_->remove(prefix_ + service, key);
  std::lock_guard lock(mutex_);
  written_.erase({prefix_ + service, key});
}

void PrefixedSecretStore::clear() {
  std::set<std::pair<std::string, std::string>> written;
  {
    std::lock_guard lock(mutex_);
    written.swap(written_);
  }
  for (const auto &[service, key] : written) {
    try {
      inner_->remove(service, key);
    } catch (const std::exception &) {
      // Left for the next test launch, which removes what a run before it left.
    }
  }
}

std::shared_ptr<FileDialogs> makeDismissedFileDialogs() {
  struct Dismissed final : FileDialogs {
    void openFiles(const OpenRequest &, std::function<void(std::optional<std::vector<std::string>>)> done) override {
      done(std::nullopt);
    }
    void saveFile(const SaveRequest &, std::function<void(std::optional<std::string>)> done) override { done(std::nullopt); }
    void chooseFolder(std::function<void(std::optional<std::string>)> done) override { done(std::nullopt); }
  };
  return std::make_shared<Dismissed>();
}

std::optional<std::string> MovingSecretStore::get(const std::string &service, const std::string &key) {
  if (auto value = now_->get(service, key)) {
    return value;
  }
  std::optional<std::string> value;
  try {
    value = old_->get(service, key);
  } catch (const std::exception &) {
    // An old store that cannot be read has nothing to move.
    return std::nullopt;
  }
  if (value) {
    now_->set(service, key, *value);
    removeOld(service, key);
  }
  return value;
}

void MovingSecretStore::set(const std::string &service, const std::string &key, const std::string &value) {
  now_->set(service, key, value);
  removeOld(service, key);
}

void MovingSecretStore::remove(const std::string &service, const std::string &key) {
  now_->remove(service, key);
  removeOld(service, key);
}

void MovingSecretStore::removeOld(const std::string &service, const std::string &key) {
  try {
    old_->remove(service, key);
  } catch (const std::exception &) {
    // The new store has the answer; an old copy left behind is never read while it does.
  }
}

bool usesDataProtectionKeychain(const std::string &teamId, const std::set<std::string> &entitlements) {
  return !teamId.empty() &&
      (entitlements.contains("com.apple.application-identifier") || entitlements.contains("keychain-access-groups"));
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

std::shared_ptr<NativeModule> makeDesktopClipboardModule(std::shared_ptr<System> system, std::shared_ptr<HostState> state) {
  struct Clipboard : NativeModule {
    Clipboard(std::shared_ptr<System> system, std::shared_ptr<HostState> state) : NativeModule("NgNativeClipboard") {
      promise("getStringAsync", [system](const folly::dynamic &, JsPromise promise) {
        promise.resolve(system->clipboardText().value_or(""));
      });
      promise("setStringAsync", [system, state](const folly::dynamic &args, JsPromise promise) {
        system->setClipboardText(stringArg(args, 0));
        state->clipboardChangeCount.set(system->clipboardChangeCount());
        promise.resolve(true);
      });
      promise("hasStringAsync", [system](const folly::dynamic &, JsPromise promise) {
        auto text = system->clipboardText();
        promise.resolve(text.has_value() && !text->empty());
      });
      // DeviceEventEmitter's `ngNativeClipboard`, with no payload: the contents are read only when
      // asked for.
      subscription = state->clipboardChangeCount.listen(
          [this](const int64_t &) { emit("ngNativeClipboard", folly::dynamic::object()); });
    }
    std::shared_ptr<void> subscription;
  };
  return std::make_shared<Clipboard>(std::move(system), std::move(state));
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

std::string mimeTypeOf(const std::string &name) {
  static const std::map<std::string, std::string> types{
      {"txt", "text/plain"}, {"csv", "text/csv"}, {"html", "text/html"}, {"htm", "text/html"},
      {"md", "text/markdown"}, {"json", "application/json"}, {"xml", "application/xml"},
      {"pdf", "application/pdf"}, {"zip", "application/zip"}, {"png", "image/png"}, {"jpg", "image/jpeg"},
      {"jpeg", "image/jpeg"}, {"gif", "image/gif"}, {"heic", "image/heic"}, {"webp", "image/webp"},
      {"svg", "image/svg+xml"}, {"tiff", "image/tiff"}, {"mp3", "audio/mpeg"}, {"m4a", "audio/mp4"},
      {"wav", "audio/wav"}, {"mp4", "video/mp4"}, {"mov", "video/quicktime"},
  };
  auto dot = name.rfind('.');
  if (dot == std::string::npos) {
    return "application/octet-stream";
  }
  std::string ext = name.substr(dot + 1);
  std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return std::tolower(c); });
  auto it = types.find(ext);
  return it == types.end() ? "application/octet-stream" : it->second;
}

namespace {

std::vector<std::string> stringsIn(const folly::dynamic &value) {
  std::vector<std::string> out;
  if (value.isString()) {
    out.push_back(value.asString());
  } else if (value.isArray()) {
    for (const auto &item : value) {
      if (item.isString()) {
        out.push_back(item.asString());
      }
    }
  }
  return out;
}

const folly::dynamic &field(const folly::dynamic &args, const char *key) {
  static const folly::dynamic none = nullptr;
  if (args.size() > 0 && args[0].isObject()) {
    if (const auto *value = args[0].get_ptr(key)) {
      return *value;
    }
  }
  return none;
}

} // namespace

std::shared_ptr<NativeModule> makeDocumentPickerModule(
    std::shared_ptr<FileDialogs> dialogs,
    std::string cacheDirectory,
    std::shared_ptr<FileAccess> access) {
  namespace fs = std::filesystem;
  struct DocumentPicker : NativeModule {
    DocumentPicker(std::shared_ptr<FileDialogs> dialogs, std::string cache, std::shared_ptr<FileAccess> access)
        : NativeModule("NgNativeDocumentPicker") {
      // What the user chose in a panel, the app may read and write.
      auto allow = [access](const std::string &path) {
        if (access) {
          access->allowPicked(path);
        }
      };
      promise("getDocumentAsync", [dialogs, cache, allow](const folly::dynamic &args, JsPromise p) {
        FileDialogs::OpenRequest request{
            .types = stringsIn(field(args, "type")), .multiple = field(args, "multiple").isBool() && field(args, "multiple").asBool()};
        // "*/*" is any file, as no types are.
        std::erase(request.types, "*/*");
        bool copy = !field(args, "copyToCacheDirectory").isBool() || field(args, "copyToCacheDirectory").asBool();
        dialogs->openFiles(request, [p, copy, cache, allow](std::optional<std::vector<std::string>> files) {
          if (!files) {
            p.resolve(folly::dynamic::object("canceled", true)("assets", nullptr));
            return;
          }
          folly::dynamic assets = folly::dynamic::array();
          try {
            for (const auto &file : *files) {
              fs::path source(file);
              fs::path at = source;
              if (copy) {
                // A folder of its own per pick keeps two files of one name apart.
                auto folder = fs::path(cache) / "DocumentPicker" /
                    std::to_string(std::chrono::steady_clock::now().time_since_epoch().count());
                fs::create_directories(folder);
                at = folder / source.filename();
                fs::copy_file(source, at, fs::copy_options::overwrite_existing);
              } else {
                allow(source.string());
              }
              // The file clock's epoch to the system clock's, without C++20's clock_cast.
              auto written = fs::last_write_time(source);
              auto modified = std::chrono::duration_cast<std::chrono::milliseconds>(
                  (written - fs::file_time_type::clock::now() + std::chrono::system_clock::now()).time_since_epoch());
              assets.push_back(folly::dynamic::object("uri", fileUri(at.string()))("name", source.filename().string())(
                  "size", static_cast<int64_t>(fs::file_size(source)))("mimeType", mimeTypeOf(source.filename().string()))(
                  "lastModified", static_cast<int64_t>(modified.count())));
            }
          } catch (const std::exception &e) {
            p.reject(std::string("The picked file could not be read: ") + e.what());
            return;
          }
          p.resolve(folly::dynamic::object("canceled", false)("assets", assets));
        });
      });
      promise("saveDocumentAsync", [dialogs, allow](const folly::dynamic &args, JsPromise p) {
        const auto &contents = field(args, "contents");
        std::optional<std::string> bytes;
        if (contents.isString()) {
          bytes = contents.asString();
        } else if (contents.isObject() && contents.get_ptr("base64") && contents["base64"].isString()) {
          bytes = base64Decode(contents["base64"].asString());
        }
        if (!bytes) {
          p.reject("saveDocumentAsync takes contents as text or as {base64}.");
          return;
        }
        FileDialogs::SaveRequest request{
            .suggestedName = field(args, "suggestedName").isString() ? field(args, "suggestedName").asString() : "",
            .types = stringsIn(field(args, "types"))};
        dialogs->saveFile(request, [p, allow, bytes = std::move(*bytes)](std::optional<std::string> path) {
          if (!path) {
            p.resolve(nullptr);
            return;
          }
          std::ofstream out(*path, std::ios::binary | std::ios::trunc);
          out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
          if (!out) {
            p.reject("The file could not be written: " + *path);
            return;
          }
          allow(*path);
          p.resolve(fileUri(*path));
        });
      });
      promise("pickDirectoryAsync", [dialogs, allow](const folly::dynamic &, JsPromise p) {
        dialogs->chooseFolder([p, allow](std::optional<std::string> folder) {
          if (folder) {
            allow(*folder);
          }
          p.resolve(folder ? folly::dynamic::object("uri", fileUri(*folder)) : folly::dynamic(nullptr));
        });
      });
    }
  };
  return std::make_shared<DocumentPicker>(std::move(dialogs), std::move(cacheDirectory), std::move(access));
}

} // namespace ngn
