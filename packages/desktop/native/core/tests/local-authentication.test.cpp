#include "ngn/local-authentication.h"

#include <doctest/doctest.h>

#include <optional>

using folly::dynamic;
using Failure = ngn::Authenticator::Failure;

namespace {

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer ask(const ngn::NativeModule &module, const std::string &method, dynamic args = dynamic::array()) {
  Answer answer;
  module.callWithPromise(
      method, args,
      {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

// Answers each evaluation with `outcome`, or holds it until `finish` when `hold` is set.
struct FakeAuthenticator final : ngn::Authenticator {
  Facts mac;
  std::optional<Failure> outcome;
  bool hold{false};
  std::vector<Request> asked;
  std::function<void(std::optional<Failure>)> pending;
  int cancels{0};

  Facts facts() override {
    return mac;
  }
  void evaluate(const Request &request, std::function<void(std::optional<Failure>)> done) override {
    asked.push_back(request);
    if (hold) {
      pending = std::move(done);
    } else {
      done(outcome);
    }
  }
  void cancel() override {
    cancels++;
    if (pending) {
      auto done = std::move(pending);
      pending = nullptr;
      done(Failure::AppCancel);
    }
  }
};

ngn::Authenticator::Facts touchId(std::optional<Failure> unusable = std::nullopt) {
  return {.biometry = ngn::Authenticator::Biometry::TouchId, .biometryUnusable = unusable, .passwordSet = true};
}

} // namespace

TEST_CASE("LocalAuthentication reports a Mac with no Touch ID as having no hardware, and its password as the level") {
  auto mac = std::make_shared<FakeAuthenticator>();
  mac->mac = {.passwordSet = true};
  auto module = ngn::makeLocalAuthenticationModule(mac);
  CHECK(ask(*module, "hasHardwareAsync").value == dynamic(false));
  CHECK(ask(*module, "isEnrolledAsync").value == dynamic(false));
  CHECK(ask(*module, "supportedAuthenticationTypesAsync").value == dynamic::array());
  CHECK(ask(*module, "getEnrolledLevelAsync").value == dynamic(1));

  mac->mac = {};
  CHECK(ask(*module, "getEnrolledLevelAsync").value == dynamic(0));
}

TEST_CASE("LocalAuthentication reports Touch ID, enrolled or not") {
  auto mac = std::make_shared<FakeAuthenticator>();
  mac->mac = touchId(Failure::BiometryNotEnrolled);
  auto module = ngn::makeLocalAuthenticationModule(mac);
  CHECK(ask(*module, "hasHardwareAsync").value == dynamic(true));
  CHECK(ask(*module, "isEnrolledAsync").value == dynamic(false));
  CHECK(ask(*module, "supportedAuthenticationTypesAsync").value == dynamic::array(1));
  CHECK(ask(*module, "getEnrolledLevelAsync").value == dynamic(1));

  mac->mac = touchId();
  CHECK(ask(*module, "isEnrolledAsync").value == dynamic(true));
  CHECK(ask(*module, "getEnrolledLevelAsync").value == dynamic(3));

  mac->mac.biometry = ngn::Authenticator::Biometry::FaceId;
  CHECK(ask(*module, "supportedAuthenticationTypesAsync").value == dynamic::array(2));
  mac->mac.biometry = ngn::Authenticator::Biometry::OpticId;
  CHECK(ask(*module, "supportedAuthenticationTypesAsync").value == dynamic::array(3));
}

TEST_CASE("LocalAuthentication passes the prompt's message and labels, with the password as fallback by default") {
  auto mac = std::make_shared<FakeAuthenticator>();
  mac->mac = touchId();
  auto module = ngn::makeLocalAuthenticationModule(mac);

  CHECK(ask(*module, "authenticateAsync", dynamic::array(dynamic::object("promptMessage", "Unlock notes"))).value ==
        dynamic(dynamic::object("success", true)));
  REQUIRE(mac->asked.size() == 1);
  CHECK(mac->asked[0].reason == "Unlock notes");
  CHECK_FALSE(mac->asked[0].biometricsOnly);
  CHECK_FALSE(mac->asked[0].cancelTitle);
  CHECK_FALSE(mac->asked[0].fallbackTitle);

  ask(*module, "authenticateAsync",
      dynamic::array(dynamic::object("promptMessage", "Pay")("cancelLabel", "Not now")("fallbackLabel", "Use password")));
  CHECK(mac->asked[1].cancelTitle == "Not now");
  CHECK(mac->asked[1].fallbackTitle == "Use password");

  // Touch ID only hides the fallback button unless a label is given, as on iOS.
  ask(*module, "authenticateAsync", dynamic::array(dynamic::object("promptMessage", "Pay")("disableDeviceFallback", true)));
  CHECK(mac->asked[2].biometricsOnly);
  CHECK(mac->asked[2].fallbackTitle == "");
}

TEST_CASE("LocalAuthentication answers a denied or failed prompt with expo's error names") {
  auto mac = std::make_shared<FakeAuthenticator>();
  mac->mac = touchId();
  auto module = ngn::makeLocalAuthenticationModule(mac);
  auto args = dynamic::array(dynamic::object("promptMessage", "Unlock"));
  for (auto [failure, name] : std::vector<std::pair<Failure, const char *>>{
           {Failure::UserCancel, "user_cancel"},
           {Failure::AuthenticationFailed, "authentication_failed"},
           {Failure::UserFallback, "user_fallback"},
           {Failure::SystemCancel, "system_cancel"},
           {Failure::BiometryLockout, "lockout"},
           {Failure::PasscodeNotSet, "passcode_not_set"},
           {Failure::NotInteractive, "not_interactive"},
           {Failure::Other, "unknown"},
       }) {
    CAPTURE(name);
    mac->outcome = failure;
    CHECK(ask(*module, "authenticateAsync", args).value == dynamic(dynamic::object("success", false)("error", name)));
  }
}

TEST_CASE("LocalAuthentication answers at once, with no prompt, when Touch ID alone is asked for and cannot be used") {
  auto mac = std::make_shared<FakeAuthenticator>();
  auto module = ngn::makeLocalAuthenticationModule(mac);
  auto args = dynamic::array(dynamic::object("promptMessage", "Unlock")("disableDeviceFallback", true));
  mac->mac = {.passwordSet = true};
  CHECK(ask(*module, "authenticateAsync", args).value == dynamic(dynamic::object("success", false)("error", "not_available")));
  mac->mac = touchId(Failure::BiometryNotEnrolled);
  CHECK(ask(*module, "authenticateAsync", args).value == dynamic(dynamic::object("success", false)("error", "not_enrolled")));
  // Locked out, or the lid closed, which LAContext reports as a system cancel.
  mac->mac = touchId(Failure::BiometryLockout);
  CHECK(ask(*module, "authenticateAsync", args).value == dynamic(dynamic::object("success", false)("error", "lockout")));
  mac->mac = touchId(Failure::SystemCancel);
  CHECK(ask(*module, "isEnrolledAsync").value == dynamic(false));
  CHECK(ask(*module, "authenticateAsync", args).value == dynamic(dynamic::object("success", false)("error", "system_cancel")));
  CHECK(mac->asked.empty());

  // With the password as a fallback the prompt is shown, since the password can answer it.
  CHECK(ask(*module, "authenticateAsync", dynamic::array(dynamic::object("promptMessage", "Unlock"))).value ==
        dynamic(dynamic::object("success", true)));
  CHECK(mac->asked.size() == 1);
}

TEST_CASE("LocalAuthentication refuses a prompt with no message, as expo-local-authentication does") {
  auto mac = std::make_shared<FakeAuthenticator>();
  mac->mac = touchId();
  auto module = ngn::makeLocalAuthenticationModule(mac);
  CHECK(ask(*module, "authenticateAsync").error);
  CHECK(ask(*module, "authenticateAsync", dynamic::array(dynamic::object("promptMessage", ""))).error);
  CHECK(mac->asked.empty());
}

TEST_CASE("LocalAuthentication's cancelAuthenticate ends the prompt in progress as app_cancel") {
  auto mac = std::make_shared<FakeAuthenticator>();
  mac->mac = touchId();
  mac->hold = true;
  auto module = ngn::makeLocalAuthenticationModule(mac);
  Answer answer;
  module->callWithPromise(
      "authenticateAsync", dynamic::array(dynamic::object("promptMessage", "Unlock")),
      {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  CHECK_FALSE(answer.value);
  ask(*module, "cancelAuthenticate");
  CHECK(mac->cancels == 1);
  CHECK(answer.value == dynamic(dynamic::object("success", false)("error", "app_cancel")));
}
