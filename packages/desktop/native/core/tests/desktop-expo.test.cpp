#include "fake-system.h"
#include "ngn/desktop-expo.h"

#include <doctest/doctest.h>

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
  auto module = ngn::makeDesktopClipboardModule(system);
  CHECK(ask(*module, "hasStringAsync", dynamic::array()).value == dynamic(false));
  CHECK(ask(*module, "setStringAsync", dynamic::array("copied")).value == dynamic(true));
  CHECK(ask(*module, "getStringAsync", dynamic::array()).value == dynamic("copied"));
  CHECK(ask(*module, "hasStringAsync", dynamic::array()).value == dynamic(true));
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
