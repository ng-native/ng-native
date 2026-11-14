#include "fake-system.h"
#include "ngn/desktop-expo.h"
#include "ngn/host-state.h"

#include <folly/json.h>

#include <doctest/doctest.h>

#include <filesystem>
#include <fstream>

using folly::dynamic;

namespace {

using Lines = std::vector<std::string>;

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer ask(const ngn::NativeModule &module, const std::string &method, dynamic args) {
  Answer answer;
  module.callWithPromise(
      method, args,
      {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

struct MemorySecrets final : ngn::SecretStore {
  std::map<std::pair<std::string, std::string>, std::string> items;
  bool failing{false};
  std::optional<std::string> get(const std::string &s, const std::string &k) override {
    if (failing) {
      throw std::runtime_error("the keychain is locked");
    }
    auto it = items.find({s, k});
    return it == items.end() ? std::nullopt : std::optional(it->second);
  }
  void set(const std::string &s, const std::string &k, const std::string &v) override {
    items[{s, k}] = v;
  }
  void remove(const std::string &s, const std::string &k) override {
    items.erase({s, k});
  }
};

} // namespace

TEST_CASE("SecureStore keeps items under the app's service, or the one a call names") {
  auto secrets = std::make_shared<MemorySecrets>();
  auto module = ngn::makeSecureStoreModule(secrets, "com.example.app");
  CHECK(ask(*module, "setItemAsync", dynamic::array("token", "abc")).value == dynamic(nullptr));
  CHECK(secrets->items.at({"com.example.app", "token"}) == "abc");
  CHECK(ask(*module, "getItemAsync", dynamic::array("token")).value == dynamic("abc"));
  CHECK(module->call("getItem", dynamic::array("token")) == dynamic("abc"));
  CHECK(ask(*module, "getItemAsync", dynamic::array("missing")).value == dynamic(nullptr));

  ask(*module, "setItemAsync", dynamic::array("token", "other", dynamic::object("keychainService", "shared")));
  CHECK(secrets->items.at({"shared", "token"}) == "other");
  CHECK(ask(*module, "getItemAsync", dynamic::array("token")).value == dynamic("abc"));

  ask(*module, "deleteItemAsync", dynamic::array("token"));
  CHECK(ask(*module, "getItemAsync", dynamic::array("token")).value == dynamic(nullptr));
  CHECK(module->call("canUseBiometricAuthentication") == dynamic(false));
}

TEST_CASE("SecureStore refuses a key expo-secure-store refuses, a value that is not a string, and reports a failing store") {
  auto secrets = std::make_shared<MemorySecrets>();
  auto module = ngn::makeSecureStoreModule(secrets, "app");
  for (const char *key : {"", "a b", "../x", "key/with/slash", "ключ"}) {
    CAPTURE(key);
    CHECK(ask(*module, "setItemAsync", dynamic::array(key, "v")).error);
  }
  CHECK(ask(*module, "setItemAsync", dynamic::array("ok", 3)).error);
  CHECK(secrets->items.empty());
  CHECK(ngn::secureStoreKeyValid("user.token-1_a"));
  secrets->failing = true;
  CHECK(ask(*module, "getItemAsync", dynamic::array("ok")).error == "the keychain is locked");
  CHECK(module->call("getItem", dynamic::array("ok")) == dynamic(nullptr));
}

TEST_CASE("Clipboard reads and writes the pasteboard") {
  auto system = std::make_shared<ngn::testing::FakeSystem>();
  auto module = ngn::makeDesktopClipboardModule(system, std::make_shared<ngn::HostState>());
  CHECK(ask(*module, "hasStringAsync", dynamic::array()).value == dynamic(false));
  CHECK(ask(*module, "setStringAsync", dynamic::array("copied")).value == dynamic(true));
  CHECK(ask(*module, "getStringAsync", dynamic::array()).value == dynamic("copied"));
  CHECK(ask(*module, "hasStringAsync", dynamic::array()).value == dynamic(true));
}

TEST_CASE("Clipboard sends ngNativeClipboard each time the pasteboard's change count moves") {
  auto system = std::make_shared<ngn::testing::FakeSystem>();
  auto state = std::make_shared<ngn::HostState>();
  state->clipboardChangeCount.set(system->clipboardChangeCount());
  auto module = ngn::makeDesktopClipboardModule(system, state);
  Lines events;
  module->setEmitter([&](const std::string &event, dynamic body) { events.push_back(event + " " + folly::toJson(body)); });

  // Another app copied: the backend saw the count move.
  ++system->clipboardChanges;
  state->clipboardChangeCount.set(system->clipboardChangeCount());
  // Checked again with nothing new: no event.
  state->clipboardChangeCount.set(system->clipboardChangeCount());
  CHECK(events == Lines{"ngNativeClipboard {}"});
  // The app's own write counts too, once.
  ask(*module, "setStringAsync", dynamic::array("mine"));
  CHECK(events == Lines{"ngNativeClipboard {}", "ngNativeClipboard {}"});

  // A reload's new module hears changes; the old one hears nothing more.
  module.reset();
  auto again = ngn::makeDesktopClipboardModule(system, state);
  Lines heard;
  again->setEmitter([&](const std::string &event, dynamic) { heard.push_back(event); });
  ++system->clipboardChanges;
  state->clipboardChangeCount.set(system->clipboardChangeCount());
  CHECK(heard == Lines{"ngNativeClipboard"});
  CHECK(events.size() == 2);
}

TEST_CASE("the display stays awake while any tag holds it") {
  struct Recorder final : ngn::SleepPreventer {
    Lines calls;
    void hold(bool awake) override { calls.push_back(awake ? "hold" : "release"); }
  };
  auto recorder = std::make_shared<Recorder>();
  auto module = ngn::makeKeepAwakeModule(std::make_shared<ngn::KeepAwakeTags>(recorder));
  ask(*module, "activateKeepAwakeAsync", dynamic::array("video"));
  ask(*module, "activateKeepAwakeAsync", dynamic::array("download"));
  ask(*module, "activateKeepAwakeAsync", dynamic::array("video"));
  ask(*module, "deactivateKeepAwake", dynamic::array("video"));
  CHECK(recorder->calls == Lines{"hold"});
  ask(*module, "deactivateKeepAwake", dynamic::array("unknown"));
  ask(*module, "deactivateKeepAwake", dynamic::array("download"));
  CHECK(recorder->calls == Lines{"hold", "release"});
}

TEST_CASE("each haptics call plays the trackpad's matching feedback") {
  struct Recorder final : ngn::HapticPlayer {
    std::vector<Pattern> played;
    void play(Pattern p) override { played.push_back(p); }
  };
  auto recorder = std::make_shared<Recorder>();
  auto module = ngn::makeHapticsModule(recorder);
  ask(*module, "impactAsync", dynamic::array("light"));
  ask(*module, "selectionAsync", dynamic::array());
  ask(*module, "notificationAsync", dynamic::array("success"));
  using P = ngn::HapticPlayer::Pattern;
  CHECK(recorder->played == std::vector<P>{P::Generic, P::Alignment, P::LevelChange});
}

namespace {

struct FixedLocales final : ngn::LocaleSource {
  std::vector<ngn::LocaleFacts> preferred;
  ngn::CalendarFacts calendar;
  std::vector<ngn::LocaleFacts> locales() override {
    return preferred;
  }
  ngn::CalendarFacts calendars() override {
    return calendar;
  }
};

} // namespace

TEST_CASE("Localization answers expo-localization's locales and calendars") {
  auto source = std::make_shared<FixedLocales>();
  ngn::LocaleFacts formats{
      .decimalSeparator = ",",
      .groupingSeparator = ".",
      .measurementSystem = "Metric",
      .currencyCode = "EUR",
      .currencySymbol = "€",
      .temperatureUnit = "celsius",
  };
  auto german = formats;
  german.languageTag = "de-DE";
  auto arabic = formats;
  arabic.languageTag = "ar";
  arabic.rightToLeft = true;
  auto british = formats;
  british.languageTag = "en-GB";
  british.measurementSystem = "U.K.";
  auto chinese = formats;
  chinese.languageTag = "zh-Hant-TW";
  chinese.measurementSystem = "U.S.";
  source->preferred = {german, arabic, british, chinese};
  source->calendar = {.calendar = "gregorian", .timeZone = "Europe/Berlin", .uses24hourClock = true, .firstWeekday = 2};
  auto module = ngn::makeLocalizationModule(source, "DE");

  auto locales = module->call("getLocales");
  REQUIRE(locales.size() == 4);
  CHECK(locales[0] == dynamic::object("languageTag", "de-DE")("languageCode", "de")("languageScriptCode", nullptr)(
                          "regionCode", "DE")("languageRegionCode", "DE")("textDirection", "ltr")(
                          "decimalSeparator", ",")("digitGroupingSeparator", ".")("measurementSystem", "metric")(
                          "currencyCode", "EUR")("currencySymbol", "€")("languageCurrencyCode", "EUR")(
                          "languageCurrencySymbol", "€")("temperatureUnit", "celsius"));
  // A tag with no region takes the system's, as on iOS; its language's own region stays null.
  CHECK(locales[1]["textDirection"] == "rtl");
  CHECK(locales[1]["regionCode"] == "DE");
  CHECK(locales[1]["languageRegionCode"] == nullptr);
  CHECK(locales[2]["measurementSystem"] == "uk");
  CHECK(locales[3]["languageCode"] == "zh");
  CHECK(locales[3]["languageScriptCode"] == "Hant");
  CHECK(locales[3]["languageRegionCode"] == "TW");
  CHECK(locales[3]["measurementSystem"] == "us");

  CHECK(module->call("getCalendars") == dynamic::array(dynamic::object("calendar", "gregorian")("timeZone", "Europe/Berlin")(
                                            "uses24hourClock", true)("firstWeekday", 2)));

  // Never an empty list: Locale's first one is the one to format with.
  source->preferred.clear();
  auto fallback = module->call("getLocales");
  REQUIRE(fallback.size() == 1);
  CHECK(fallback[0]["languageTag"] == "en-DE");
}

namespace {

namespace fs = std::filesystem;

struct ScriptedDialogs final : ngn::FileDialogs {
  std::vector<std::string> log;
  std::optional<std::vector<std::string>> picked;
  std::optional<std::string> savedAt;
  std::optional<std::string> folder;
  void openFiles(const OpenRequest &request, std::function<void(std::optional<std::vector<std::string>>)> done) override {
    std::string types;
    for (const auto &t : request.types) {
      types += t + " ";
    }
    log.push_back("open " + types + (request.multiple ? "multiple" : "one"));
    done(picked);
  }
  void saveFile(const SaveRequest &request, std::function<void(std::optional<std::string>)> done) override {
    log.push_back("save " + request.suggestedName + " " + (request.types.empty() ? "" : request.types[0]));
    done(savedAt);
  }
  void chooseFolder(std::function<void(std::optional<std::string>)> done) override {
    log.push_back("folder");
    done(folder);
  }
};

struct TempDir {
  fs::path path = fs::temp_directory_path() / ("ngn-docs-" + std::to_string(reinterpret_cast<uintptr_t>(this)));
  TempDir() {
    fs::remove_all(path);
    fs::create_directories(path);
  }
  ~TempDir() {
    fs::remove_all(path);
  }
};

void writeText(const fs::path &file, const std::string &text) {
  std::ofstream(file, std::ios::binary) << text;
}

std::string readText(const fs::path &file) {
  std::ifstream in(file, std::ios::binary);
  return std::string(std::istreambuf_iterator<char>(in), {});
}

} // namespace

TEST_CASE("DocumentPicker opens files as expo-document-picker answers them, copied to the cache by default") {
  TempDir home;
  TempDir cache;
  writeText(home.path / "notes.txt", "hello");
  writeText(home.path / "photo.PNG", "png bytes");
  auto dialogs = std::make_shared<ScriptedDialogs>();
  auto module = ngn::makeDocumentPickerModule(dialogs, cache.path.string());

  dialogs->picked = std::vector<std::string>{(home.path / "notes.txt").string(), (home.path / "photo.PNG").string()};
  auto picked = ask(*module, "getDocumentAsync", dynamic::array(dynamic::object("type", dynamic::array("text/plain", "image/*"))("multiple", true)));
  REQUIRE(picked.value);
  CHECK(dialogs->log == Lines{"open text/plain image/* multiple"});
  CHECK((*picked.value)["canceled"] == false);
  const auto &assets = (*picked.value)["assets"];
  REQUIRE(assets.size() == 2);
  CHECK(assets[0]["name"] == "notes.txt");
  CHECK(assets[0]["size"] == 5);
  CHECK(assets[0]["mimeType"] == "text/plain");
  CHECK(assets[1]["mimeType"] == "image/png");
  // A copy in the cache, so it can be read after the user moves the original.
  auto uri = assets[0]["uri"].asString();
  CHECK(uri.rfind("file://" + cache.path.string(), 0) == 0);
  CHECK(readText(uri.substr(7)) == "hello");

  // Without the copy, the file where it is.
  dialogs->picked = std::vector<std::string>{(home.path / "notes.txt").string()};
  auto direct = ask(*module, "getDocumentAsync", dynamic::array(dynamic::object("copyToCacheDirectory", false)));
  CHECK((*direct.value)["assets"][0]["uri"] == "file://" + (home.path / "notes.txt").string());

  // Dismissed: canceled, no assets.
  dialogs->picked = std::nullopt;
  auto cancelled = ask(*module, "getDocumentAsync", dynamic::array());
  CHECK((*cancelled.value)["canceled"] == true);
  CHECK((*cancelled.value)["assets"] == nullptr);
}

TEST_CASE("DocumentPicker saves text or base64 bytes where the save panel says, and picks a folder") {
  TempDir home;
  auto dialogs = std::make_shared<ScriptedDialogs>();
  auto module = ngn::makeDocumentPickerModule(dialogs, home.path.string());

  dialogs->savedAt = (home.path / "export.csv").string();
  auto saved = ask(*module, "saveDocumentAsync", dynamic::array(dynamic::object("suggestedName", "export.csv")(
                                                     "contents", "a,b\n")("types", dynamic::array("text/csv"))));
  CHECK(dialogs->log == Lines{"save export.csv text/csv"});
  CHECK(saved.value == dynamic("file://" + (home.path / "export.csv").string()));
  CHECK(readText(home.path / "export.csv") == "a,b\n");

  // Bytes come as base64, which a TurboModule carries where a Uint8Array would not.
  dialogs->savedAt = (home.path / "blob.bin").string();
  ask(*module, "saveDocumentAsync", dynamic::array(dynamic::object("suggestedName", "blob.bin")("contents", dynamic::object("base64", "AAEC"))));
  CHECK(readText(home.path / "blob.bin") == std::string("\x00\x01\x02", 3));

  dialogs->savedAt = std::nullopt;
  CHECK(ask(*module, "saveDocumentAsync", dynamic::array(dynamic::object("suggestedName", "x.txt")("contents", "x"))).value == dynamic(nullptr));

  dialogs->folder = home.path.string();
  CHECK(ask(*module, "pickDirectoryAsync", dynamic::array()).value == dynamic(dynamic::object("uri", "file://" + home.path.string())));
  dialogs->folder = std::nullopt;
  CHECK(ask(*module, "pickDirectoryAsync", dynamic::array()).value == dynamic(nullptr));
}
