#include "fake-system.h"
#include "ngn/core-modules.h"

#include <doctest/doctest.h>
#include <folly/json.h>

using folly::dynamic;
using ngn::testing::FakeSystem;

namespace {

struct Fixture {
  std::shared_ptr<FakeSystem> system = std::make_shared<FakeSystem>();
  std::shared_ptr<ngn::HostState> state = std::make_shared<ngn::HostState>();
  ngn::CoreModuleServices services{.system = system, .state = state, .reactNativeVersion = "0.88.0"};
  std::vector<std::string> events;

  std::shared_ptr<ngn::NativeModule> make(std::shared_ptr<ngn::NativeModule> module) {
    module->setEmitter([this](const std::string &event, dynamic body) { events.push_back(event + " " + folly::toJson(body)); });
    return module;
  }
};

ngn::JsPromise recording(std::string &out) {
  return {[&out](dynamic v) { out = "resolved " + folly::toJson(v); }, [&out](const std::string &m) { out = "rejected " + m; }};
}

} // namespace

TEST_CASE("PlatformConstants reports macOS, its version and the React Native the host was built from") {
  Fixture f;
  auto c = ngn::makePlatformConstants(f.services)->call("getConstants");
  CHECK(c["systemName"] == "macOS");
  CHECK(c["osVersion"] == "26.1");
  CHECK(c["interfaceIdiom"] == "mac");
  CHECK(c["forceTouchAvailable"] == false);
  CHECK(c["reactNativeVersion"] == dynamic::object("major", 0)("minor", 88)("patch", 0)("prerelease", nullptr));

  f.services.reactNativeVersion = "0.89.0-rc.1";
  auto rc = ngn::makePlatformConstants(f.services)->call("getConstants")["reactNativeVersion"];
  CHECK(rc["minor"] == 89);
  CHECK(rc["prerelease"] == "rc.1");
}

TEST_CASE("DeviceInfo gives the window's dimensions and sends them again when they change") {
  Fixture f;
  ngn::Dimensions window{.width = 1040, .height = 720, .scale = 2, .fontScale = 1};
  f.state->metrics.set({.window = window, .screen = {.width = 1728, .height = 1117, .scale = 2, .fontScale = 1}});
  auto module = f.make(ngn::makeDeviceInfo(f.services));
  auto c = module->call("getConstants");
  CHECK(c["Dimensions"]["window"]["width"] == 1040);
  CHECK(c["Dimensions"]["screen"]["height"] == 1117);

  window.width = 800;
  f.state->metrics.set({.window = window, .screen = {.width = 1728, .height = 1117, .scale = 2, .fontScale = 1}});
  REQUIRE(f.events.size() == 1);
  CHECK(f.events[0].rfind("didUpdateDimensions ", 0) == 0);
  CHECK(f.events[0].find("\"width\":800") != std::string::npos);

  // Setting the same metrics again sends nothing; a module that is gone hears nothing.
  f.state->metrics.set(f.state->metrics.get());
  module.reset();
  window.width = 600;
  f.state->metrics.set({.window = window});
  CHECK(f.events.size() == 1);
}

TEST_CASE("AppState follows the app's activity") {
  Fixture f;
  f.state->activity.set(ngn::Activity::Inactive);
  auto module = f.make(ngn::makeAppState(f.services));
  CHECK(module->call("getConstants")["initialAppState"] == "inactive");
  dynamic current;
  module->callWithCallbacks("getCurrentAppState", dynamic::array(nullptr, nullptr), {[&](dynamic a) { current = a; }, nullptr});
  CHECK(current == dynamic::array(dynamic::object("app_state", "inactive")));

  f.state->activity.set(ngn::Activity::Active);
  f.state->activity.set(ngn::Activity::Background);
  CHECK(f.events == std::vector<std::string>{
                        R"(appStateDidChange {"app_state":"active"})", R"(appStateDidChange {"app_state":"background"})"});
}

TEST_CASE("Appearance reads the scheme, overrides it and follows the system") {
  Fixture f;
  f.state->colorScheme.set("dark");
  auto module = f.make(ngn::makeAppearance(f.services));
  CHECK(module->call("getColorScheme") == "dark");

  f.system->systemScheme = "dark";
  module->call("setColorScheme", dynamic::array("light"));
  CHECK(f.system->log == std::vector<std::string>{"scheme light"});
  CHECK(module->call("getColorScheme") == "light");
  module->call("setColorScheme", dynamic::array("unspecified"));
  CHECK(f.system->log.back() == "scheme system");
  CHECK(module->call("getColorScheme") == "dark");
  CHECK(f.events == std::vector<std::string>{R"(appearanceChanged {"colorScheme":"light"})",
                                             R"(appearanceChanged {"colorScheme":"dark"})"});
}

TEST_CASE("Linking opens URLs, answers canOpenURL and reports the initial URL") {
  Fixture f;
  auto module = f.make(ngn::makeLinking(f.services));
  std::string out;
  module->callWithPromise("getInitialURL", dynamic::array(), recording(out));
  CHECK(out == "resolved null");

  f.state->setInitialUrl("ngnfixture://start");
  module->callWithPromise("getInitialURL", dynamic::array(), recording(out));
  CHECK(out == R"(resolved "ngnfixture://start")");

  module->callWithPromise("canOpenURL", dynamic::array("https://ng-native.com"), recording(out));
  CHECK(out == "resolved true");
  module->callWithPromise("canOpenURL", dynamic::array("nope://x"), recording(out));
  CHECK(out == "resolved false");

  module->callWithPromise("openURL", dynamic::array("mailto:a@b.c"), recording(out));
  CHECK(out == "resolved true");
  module->callWithPromise("openURL", dynamic::array("nope://x"), recording(out));
  CHECK(out == "rejected Unable to open URL: nope://x");
  CHECK(f.system->log == std::vector<std::string>{"open mailto:a@b.c", "open nope://x"});

  module->callWithPromise("openSettings", dynamic::array(), recording(out));
  CHECK(out == "resolved true");
}

TEST_CASE("Linking hands the OS only the URLs Shell.openExternal would: never a file, a script or data") {
  Fixture f;
  f.system->openableSchemes.push_back("file:");
  f.system->openableSchemes.push_back("javascript:");
  auto module = f.make(ngn::makeLinking(f.services));
  std::string out;
  for (const char *url : {"file:///System/Applications/Calculator.app", "FILE:///tmp/run.command", " file:///tmp/x",
                          "javascript:alert(1)", "data:text/html,x"}) {
    CAPTURE(url);
    module->callWithPromise("openURL", dynamic::array(url), recording(out));
    CHECK(out == std::string("rejected Unable to open URL: ") + url);
    module->callWithPromise("canOpenURL", dynamic::array(url), recording(out));
    CHECK(out == "resolved false");
  }
  CHECK(f.system->log.empty());
}

TEST_CASE("a URL opened while running reaches JavaScript, even one that arrived before it listened") {
  Fixture f;
  f.state->openUrl("ngnfixture://early");
  auto module = f.make(ngn::makeLinking(f.services));
  CHECK(f.events.empty());
  module->call("addListener", dynamic::array("url"));
  module->call("addListener", dynamic::array("url"));
  f.state->openUrl("ngnfixture://later");
  CHECK(f.events == std::vector<std::string>{R"(url {"url":"ngnfixture://early"})", R"(url {"url":"ngnfixture://later"})"});

  // A reload makes a new module, which hears new URLs once; the old one hears nothing more.
  module.reset();
  auto again = f.make(ngn::makeLinking(f.services));
  again->call("addListener", dynamic::array("url"));
  f.state->openUrl("ngnfixture://after-reload");
  CHECK(f.events.size() == 3);
}

TEST_CASE("files opened from Finder reach Linking as file URLs: the first at launch is the initial URL") {
  Fixture f;
  // Open With on two files starts the app: the first is the URL it launched with, the second an
  // event once the app listens. A drop on the Dock icon while running is an event too.
  f.state->receiveUrl("file:///Users/me/a.md", false);
  f.state->receiveUrl("file:///Users/me/b.md", false);
  auto module = f.make(ngn::makeLinking(f.services));
  std::string out;
  module->callWithPromise("getInitialURL", dynamic::array(), recording(out));
  CHECK(out == R"(resolved "file:///Users/me/a.md")");
  module->call("addListener", dynamic::array("url"));
  f.state->receiveUrl("file:///Users/me/c.md", true);
  CHECK(f.events == std::vector<std::string>{R"(url {"url":"file:///Users/me/b.md"})",
                                             R"(url {"url":"file:///Users/me/c.md"})"});
}

TEST_CASE("I18nManager follows the system's direction and persists allowRTL and forceRTL") {
  Fixture f;
  f.system->deviceFacts.rightToLeft = true;
  f.system->deviceFacts.locale = "ar-EG";
  auto module = ngn::makeI18n(f.services);
  auto c = module->call("getConstants");
  CHECK(c["isRTL"] == true);
  CHECK(c["doLeftAndRightSwapInRTL"] == true);
  CHECK(c["localeIdentifier"] == "ar_EG");

  module->call("allowRTL", dynamic::array(false));
  CHECK(module->call("getConstants")["isRTL"] == false);
  CHECK(f.system->preferences.at("RCTI18nUtil_allowRTL") == false);

  module->call("forceRTL", dynamic::array(true));
  f.system->deviceFacts.rightToLeft = false;
  // A new runtime (a reload or the next launch) reads what persisted.
  CHECK(ngn::makeI18n(f.services)->call("getConstants")["isRTL"] == true);

  module->call("swapLeftAndRightInRTL", dynamic::array(false));
  CHECK(module->call("getConstants")["doLeftAndRightSwapInRTL"] == false);
}

TEST_CASE("Clipboard reads and writes the system's text") {
  Fixture f;
  auto module = ngn::makeClipboard(f.services);
  std::string out;
  module->callWithPromise("getString", dynamic::array(), recording(out));
  CHECK(out == R"(resolved "")");
  module->call("setString", dynamic::array("copied"));
  module->callWithPromise("getString", dynamic::array(), recording(out));
  CHECK(out == R"(resolved "copied")");
}

TEST_CASE("Settings keeps the app's values across runtimes") {
  Fixture f;
  auto module = ngn::makeSettingsManager(f.services);
  CHECK(module->call("getConstants")["settings"] == dynamic::object());
  module->call("setValues", dynamic::array(dynamic::object("a", 1)("b", "two")));
  module->call("deleteValues", dynamic::array(dynamic::array("a")));
  CHECK(ngn::makeSettingsManager(f.services)->call("getConstants")["settings"] == dynamic::object("b", "two"));
}

TEST_CASE("StatusBarManager, Vibration and RNSModule exist and do nothing") {
  Fixture f;
  auto statusBar = ngn::makeStatusBarManager(f.services);
  CHECK(statusBar->call("getConstants")["HEIGHT"] == 0);
  dynamic height;
  statusBar->callWithCallbacks("getHeight", dynamic::array(nullptr), {[&](dynamic a) { height = a; }});
  CHECK(height == dynamic::array(dynamic::object("height", 0)));
  statusBar->call("setStyle", dynamic::array("dark-content", false));
  ngn::makeVibration(f.services)->call("vibrate", dynamic::array(400));
  CHECK(ngn::makeScreensModule(f.services)->name() == "RNSModule");
  CHECK(ngn::makeKeyboardObserver(f.services)->methods().count("addListener") == 1);
}

TEST_CASE("an alert puts its default button on the right, then Cancel, and answers with the key") {
  // Alert.alert('Delete?', 'Gone for good', [{ text: 'Cancel', style: 'cancel' }, { text: 'Keep' },
  // { text: 'Delete', style: 'destructive' }])
  auto prepared = ngn::prepareAlert(dynamic::object("title", "Delete?")("message", "Gone for good")(
      "buttons", dynamic::array(dynamic::object("0", "Cancel"), dynamic::object("1", "Keep"), dynamic::object("2", "Delete")))(
      "cancelButtonKey", "0")("destructiveButtonKey", "2"));
  const auto &r = prepared.request;
  CHECK(r.title == "Delete?");
  CHECK(r.message == "Gone for good");
  REQUIRE(r.buttons.size() == 3);
  CHECK(r.buttons[0].label == "Delete");
  CHECK(r.buttons[0].role == ngn::AlertButtonRole::Destructive);
  CHECK(r.buttons[1].label == "Cancel");
  CHECK(r.buttons[1].role == ngn::AlertButtonRole::Cancel);
  CHECK(r.buttons[2].label == "Keep");
  CHECK(r.cancelIndex == 1);
  CHECK(prepared.keys == std::vector<std::string>{"2", "0", "1"});
}

TEST_CASE("an alert's preferred button is its default, and one with no buttons gets OK") {
  auto preferred = ngn::prepareAlert(dynamic::object("buttons", dynamic::array(dynamic::object("0", "Yes"), dynamic::object("1", "No")))(
      "preferredButtonKey", "0"));
  CHECK(preferred.keys == std::vector<std::string>{"0", "1"});
  CHECK(preferred.request.cancelIndex == -1);

  auto plain = ngn::prepareAlert(dynamic::object("title", "Saved"));
  REQUIRE(plain.request.buttons.size() == 1);
  CHECK(plain.request.buttons[0].label == "OK");
  CHECK(plain.request.cancelIndex == 0);
  CHECK(plain.keys == std::vector<std::string>{"0"});
}

TEST_CASE("a prompt has a text field and sends what was typed with the key") {
  Fixture f;
  auto module = ngn::makeAlertManager(f.services);
  dynamic answer;
  module->callWithCallbacks(
      "alertWithArgs",
      dynamic::array(
          dynamic::object("title", "Name")("type", "plain-text")("defaultValue", "Ada")(
              "buttons", dynamic::array(dynamic::object("0", "Cancel"), dynamic::object("1", "OK")))("cancelButtonKey", "0"),
          nullptr),
      {[&](dynamic a) { answer = a; }});
  REQUIRE(f.system->alerts.size() == 1);
  CHECK(f.system->alerts[0].input == ngn::AlertInput::PlainText);
  CHECK(f.system->alerts[0].defaultValue == "Ada");
  f.system->answerAlert(0, "Grace");
  CHECK(answer == dynamic::array("1", "Grace"));
}

TEST_CASE("every core module is registered under its iOS name") {
  Fixture f;
  f.services.storage = std::make_shared<ngn::KeyValueStore>("/nonexistent");
  ngn::ModuleRegistry registry;
  ngn::addCoreModules(registry, f.services);
  for (const char *name : {"PlatformConstants", "DeviceInfo", "AppState", "Appearance", "LinkingManager", "I18nManager",
                           "AlertManager", "Clipboard", "SettingsManager", "StatusBarManager", "Vibration", "KeyboardObserver", "RNSModule", "Networking", "WebSocketModule", "BlobModule",
                           "FileReaderModule", "RNCAsyncStorage", "RNAsyncStorage", "ImageLoader"}) {
    CAPTURE(name);
    CHECK(registry.module(name, nullptr));
  }
}
