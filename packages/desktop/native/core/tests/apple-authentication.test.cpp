#include "ngn/apple-authentication.h"

#include <doctest/doctest.h>

#include <optional>

using folly::dynamic;
using Provider = ngn::AppleIdProvider;

namespace {

struct FakeProvider final : Provider {
  bool signed_{true};
  std::vector<Request> requests;
  std::optional<Credential> answer;
  Failure failure{Failure::Canceled};
  std::function<void()> revoke;
  bool stopped{false};
  bool entitled() override {
    return signed_;
  }
  void perform(const Request &request, std::function<void(std::optional<Credential>, Failure)> done) override {
    requests.push_back(request);
    done(answer, failure);
  }
  void credentialState(const std::string &user, std::function<void(CredentialState)> done) override {
    done(user == "001.known" ? CredentialState::Authorized : CredentialState::NotFound);
  }
  std::string formatName(const Name &name, const std::string &style) override {
    return style + ":" + name.givenName.value_or("") + " " + name.familyName.value_or("");
  }
  std::function<void()> watchRevocations(std::function<void()> revoked) override {
    revoke = std::move(revoked);
    return [this] { stopped = true; };
  }
};

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer call(const ngn::NativeModule &module, const std::string &method, dynamic args) {
  Answer answer;
  module.callWithPromise(method, args, {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

dynamic login(dynamic scopes = dynamic::array(0, 1)) {
  return dynamic::array(dynamic::object("requestedScopes", scopes)("requestedOperation", 1)("state", "s1")("nonce", "n1"));
}

} // namespace

TEST_CASE("NgNativeAppleAuthentication is available only with the Sign in with Apple entitlement") {
  auto provider = std::make_shared<FakeProvider>();
  auto module = ngn::makeAppleAuthenticationModule(provider, false);
  CHECK(call(*module, "isAvailableAsync", dynamic::array()).value == dynamic(true));
  provider->signed_ = false;
  CHECK(call(*module, "isAvailableAsync", dynamic::array()).value == dynamic(false));
}

TEST_CASE("Without the entitlement a request is refused at once, and AuthenticationServices is never asked") {
  auto provider = std::make_shared<FakeProvider>();
  provider->signed_ = false;
  auto module = ngn::makeAppleAuthenticationModule(provider, false);
  auto answer = call(*module, "requestAsync", login());
  REQUIRE(answer.error);
  CHECK(answer.error->rfind("ERR_REQUEST_NOT_HANDLED: ", 0) == 0);
  CHECK(answer.error->find("com.apple.developer.applesignin") != std::string::npos);
  CHECK(provider->requests.empty());
}

TEST_CASE("With no prompts a request is not interactive, and shows no sheet") {
  auto provider = std::make_shared<FakeProvider>();
  auto module = ngn::makeAppleAuthenticationModule(provider, true);
  CHECK(call(*module, "requestAsync", login()).error == ngn::appleAuthenticationFailure(Provider::Failure::NotInteractive));
  CHECK(provider->requests.empty());
}

TEST_CASE("A request passes its scopes, operation, user, state and nonce, and answers expo's credential") {
  auto provider = std::make_shared<FakeProvider>();
  auto module = ngn::makeAppleAuthenticationModule(provider, false);
  Provider::Credential credential;
  credential.user = "001.abc";
  credential.email = "a@privaterelay.appleid.com";
  credential.fullName = Provider::Name{.givenName = "Ada", .familyName = "Lovelace"};
  credential.realUserStatus = 2;
  credential.state = "s1";
  credential.authorizationCode = "code";
  credential.identityToken = "token";
  provider->answer = credential;
  auto answer = call(*module, "requestAsync", login());
  REQUIRE(answer.value);
  REQUIRE(provider->requests.size() == 1);
  const auto &request = provider->requests[0];
  CHECK(request.scopes == std::vector<Provider::Scope>{Provider::Scope::FullName, Provider::Scope::Email});
  CHECK(request.operation == Provider::Operation::Login);
  CHECK(request.state == "s1");
  CHECK(request.nonce == "n1");
  CHECK_FALSE(request.user);

  CHECK(*answer.value ==
        dynamic::object("user", "001.abc")("email", "a@privaterelay.appleid.com")("realUserStatus", 2)("state", "s1")(
            "authorizationCode", "code")("identityToken", "token")(
            "fullName", dynamic::object("namePrefix", nullptr)("givenName", "Ada")("middleName", nullptr)("familyName", "Lovelace")(
                            "nameSuffix", nullptr)("nickname", nullptr)));

  // Signing out names the user, and a credential with no name has a fullName of nulls, as on iOS.
  provider->answer = Provider::Credential{.user = "001.abc"};
  auto out = call(*module, "requestAsync", dynamic::array(dynamic::object("requestedOperation", 3)("user", "001.abc")));
  REQUIRE(out.value);
  CHECK(provider->requests[1].operation == Provider::Operation::Logout);
  CHECK(provider->requests[1].user == "001.abc");
  CHECK(provider->requests[1].scopes.empty());
  CHECK((*out.value)["fullName"]["givenName"] == nullptr);
  CHECK((*out.value)["email"] == nullptr);
}

TEST_CASE("A request with an unknown scope or operation is refused with expo's codes, and a failure with iOS's") {
  auto provider = std::make_shared<FakeProvider>();
  auto module = ngn::makeAppleAuthenticationModule(provider, false);
  CHECK(call(*module, "requestAsync", login(dynamic::array(0, 7))).error == "ERR_INVALID_SCOPE: Invalid Apple authentication scope: 7");
  CHECK(call(*module, "requestAsync", dynamic::array(dynamic::object("requestedOperation", 9))).error ==
        "ERR_INVALID_OPERATION: Invalid type of Apple authentication operation: 9");
  CHECK(provider->requests.empty());

  provider->failure = Provider::Failure::Canceled;
  CHECK(call(*module, "requestAsync", login()).error == "ERR_REQUEST_CANCELED: The user canceled the authorization attempt");
  provider->failure = Provider::Failure::NoWindow;
  CHECK(call(*module, "requestAsync", login()).error->rfind("ERR_WINDOW_UNAVAILABLE: ", 0) == 0);
  CHECK(ngn::appleAuthenticationFailure(Provider::Failure::Failed) == "ERR_REQUEST_FAILED: The authorization attempt failed");
  CHECK(ngn::appleAuthenticationFailure(Provider::Failure::NotHandled).rfind("ERR_REQUEST_NOT_HANDLED: ", 0) == 0);
  CHECK(ngn::appleAuthenticationFailure(Provider::Failure::InvalidResponse).rfind("ERR_INVALID_RESPONSE: ", 0) == 0);
  CHECK(ngn::appleAuthenticationFailure(Provider::Failure::Unknown).rfind("ERR_REQUEST_UNKNOWN: ", 0) == 0);
}

TEST_CASE("The credential state is expo's number, and a name is formatted in the style asked, synchronously") {
  auto provider = std::make_shared<FakeProvider>();
  auto module = ngn::makeAppleAuthenticationModule(provider, false);
  CHECK(call(*module, "getCredentialStateAsync", dynamic::array("001.known")).value == dynamic(1));
  CHECK(call(*module, "getCredentialStateAsync", dynamic::array("someone")).value == dynamic(2));
  CHECK(module->call("formatFullName", dynamic::array(dynamic::object("givenName", "Ada")("familyName", "Lovelace"), "short")) ==
        "short:Ada Lovelace");
  CHECK(module->call("formatFullName", dynamic::array(dynamic::object("givenName", "Ada"))) == "default:Ada ");
}

TEST_CASE("A revoked credential is an event, until the module goes") {
  auto provider = std::make_shared<FakeProvider>();
  std::vector<dynamic> events;
  {
    auto module = ngn::makeAppleAuthenticationModule(provider, false);
    module->setEmitter([&](const std::string &event, dynamic body) {
      CHECK(event == "ngNativeAppleAuthentication");
      events.push_back(body);
    });
    REQUIRE(provider->revoke);
    provider->revoke();
    CHECK(events == std::vector<dynamic>{dynamic::object("type", "revoked")});
  }
  CHECK(provider->stopped);
}
